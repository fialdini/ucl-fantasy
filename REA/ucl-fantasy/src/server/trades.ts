import { and, desc, eq, inArray, lte, or } from "drizzle-orm";
import { game } from "@config/game";
import type { Db, DbOrTx } from "@/db/client";
import { fantasyTeams, leagues, players, rosterSlots, rounds, tradeItems, trades } from "@/db/schema";
import { lineupLockState } from "@/domain/lock";
import { cannotTrade, type TradePlayer, type TradeProposal } from "@/domain/trades";
import { GameError } from "./errors";
import { teamOf } from "./leagues";
import { moveRoster } from "./roster";

/**
 * Trocas entre times (estilo NFL Fantasy): um time propõe, o outro aceita ou recusa.
 * A troca é validada ao propor e de novo ao aceitar (os elencos podem ter mudado no meio-tempo).
 * Só é concluída com a rodada destravada e até a rodada `game.trades.lastRound`. Com revisão do comissário
 * ligada na liga, a troca aceita espera o prazo de revisão (o comissário pode vetar ou aprovar antes).
 */

async function rostersOf(db: DbOrTx, teamIds: readonly number[]): Promise<Map<number, TradePlayer[]>> {
  const rows = await db
    .select({ teamId: rosterSlots.teamId, playerId: rosterSlots.playerId, position: players.position, subPosition: players.subPosition, clubId: players.clubId })
    .from(rosterSlots)
    .innerJoin(players, eq(players.id, rosterSlots.playerId))
    .where(inArray(rosterSlots.teamId, [...teamIds]));
  const map = new Map<number, TradePlayer[]>(teamIds.map((id) => [id, []]));
  for (const r of rows) map.get(r.teamId)!.push(r);
  return map;
}

async function teamNames(db: DbOrTx, leagueId: number) {
  const teams = await db.select({ id: fantasyTeams.id, name: fantasyTeams.name }).from(fantasyTeams).where(eq(fantasyTeams.leagueId, leagueId));
  return (id: number) => teams.find((t) => t.id === id)?.name ?? `Time ${id}`;
}

async function tradeWindow(db: DbOrTx, now: Date) {
  const state = lineupLockState(await db.select().from(rounds), now);
  const order = state.round?.order ?? 1;
  return { ...state, order, clubCap: game.roster.clubCap(order), closed: order > game.trades.lastRound };
}

export async function proposeTrade(
  db: Db,
  input: { leagueId: number; userId: number; receiverTeamId: number; givePlayerIds: readonly number[]; getPlayerIds: readonly number[]; message?: string },
  now: Date,
) {
  const [league] = await db.select().from(leagues).where(eq(leagues.id, input.leagueId));
  if (league?.status !== "ACTIVE") throw new GameError("Trocas abrem depois do draft");
  const window = await tradeWindow(db, now);
  if (window.closed) throw new GameError(`O prazo de trocas acabou (rodada ${game.trades.lastRound})`);
  const team = await teamOf(db, input.leagueId, input.userId);
  if (!team) throw new GameError("Você não tem time nesta liga");
  const [receiver] = await db
    .select()
    .from(fantasyTeams)
    .where(and(eq(fantasyTeams.id, input.receiverTeamId), eq(fantasyTeams.leagueId, input.leagueId)));
  if (!receiver) throw new GameError("Time não encontrado nesta liga");
  const proposal: TradeProposal = {
    proposerTeamId: team.id,
    receiverTeamId: receiver.id,
    items: [
      ...input.givePlayerIds.map((playerId) => ({ playerId, fromTeamId: team.id })),
      ...input.getPlayerIds.map((playerId) => ({ playerId, fromTeamId: receiver.id })),
    ],
  };
  const reason = cannotTrade(proposal, await rostersOf(db, [team.id, receiver.id]), window.clubCap, await teamNames(db, input.leagueId));
  if (reason) throw new GameError(reason);
  return db.transaction(async (tx) => {
    const [trade] = await tx
      .insert(trades)
      .values({ leagueId: input.leagueId, proposerTeamId: team.id, receiverTeamId: receiver.id, message: input.message?.trim() || null, createdAt: now })
      .returning();
    await tx.insert(tradeItems).values(proposal.items.map((i) => ({ tradeId: trade!.id, ...i })));
    return trade!;
  });
}

type Trade = typeof trades.$inferSelect;
type TradeItem = typeof tradeItems.$inferSelect;
type TradeWindow = Awaited<ReturnType<typeof tradeWindow>>;

async function loadTrade(db: DbOrTx, leagueId: number, tradeId: number, statuses: ReadonlyArray<Trade["status"]> = ["PENDING"]) {
  const [trade] = await db.select().from(trades).where(and(eq(trades.id, tradeId), eq(trades.leagueId, leagueId)));
  if (!trade) throw new GameError("Proposta não encontrada");
  if (!statuses.includes(trade.status)) {
    throw new GameError(trade.status === "REVIEW" ? "Esta troca está em revisão do comissário" : "Esta proposta já foi respondida");
  }
  const items = await db.select().from(tradeItems).where(eq(tradeItems.tradeId, tradeId));
  return { trade, items };
}
const loadPending = (db: DbOrTx, leagueId: number, tradeId: number) => loadTrade(db, leagueId, tradeId);

/** Motivo pelo qual a troca deixou de ser válida agora (elencos mudaram, prazo acabou), ou null. */
async function revalidate(tx: DbOrTx, trade: Trade, items: TradeItem[], window: TradeWindow) {
  if (window.closed) return `O prazo de trocas acabou (rodada ${game.trades.lastRound})`;
  const proposal: TradeProposal = { proposerTeamId: trade.proposerTeamId, receiverTeamId: trade.receiverTeamId, items };
  return cannotTrade(proposal, await rostersOf(tx, [trade.proposerTeamId, trade.receiverTeamId]), window.clubCap, await teamNames(tx, trade.leagueId));
}

/**
 * Conclui a troca (move os jogadores). Revalida antes: se não vale mais, marca FAILED e devolve o motivo.
 * Chamar numa transação com a liga travada e a rodada destravada.
 */
async function executeTrade(tx: DbOrTx, trade: Trade, items: TradeItem[], window: TradeWindow, now: Date) {
  const reason = await revalidate(tx, trade, items, window);
  if (reason) {
    await tx.update(trades).set({ status: "FAILED", failReason: reason, respondedAt: now, reviewEndsAt: null }).where(eq(trades.id, trade.id));
    return reason;
  }
  const { leagueId, proposerTeamId: a, receiverTeamId: b } = trade;
  const outgoing = (teamId: number) => items.filter((i) => i.fromTeamId === teamId).map((i) => i.playerId);
  // Primeiro os dois lados liberam os jogadores; depois cada um recebe os do outro.
  await moveRoster(tx, { leagueId, teamId: a, drop: outgoing(a), via: "TRADE", now });
  await moveRoster(tx, { leagueId, teamId: b, drop: outgoing(b), via: "TRADE", now });
  await moveRoster(tx, { leagueId, teamId: a, add: outgoing(b), via: "TRADE", now });
  await moveRoster(tx, { leagueId, teamId: b, add: outgoing(a), via: "TRADE", now });
  await tx.update(trades).set({ status: "ACCEPTED", respondedAt: trade.respondedAt ?? now, reviewEndsAt: null }).where(eq(trades.id, trade.id));
  await failStaleTrades(tx, leagueId, items.map((i) => i.playerId), now);
  return null;
}

/** Serializa as trocas da liga: duas conclusões simultâneas não usam o mesmo jogador. */
async function lockLeagueRow(tx: DbOrTx, leagueId: number) {
  const [league] = await tx.select().from(leagues).where(eq(leagues.id, leagueId)).for("update");
  if (!league) throw new GameError("Liga não encontrada");
  return league;
}

/**
 * Aceita a proposta. Com revisão do comissário (`tradeReviewHours` > 0), a troca fica "Em revisão"
 * até o prazo e é concluída depois, se não for vetada; sem revisão, é concluída na hora.
 */
export async function acceptTrade(db: Db, leagueId: number, userId: number, tradeId: number, now: Date) {
  const team = await teamOf(db, leagueId, userId);
  const window = await tradeWindow(db, now);
  const outcome = await db.transaction(async (tx) => {
    const league = await lockLeagueRow(tx, leagueId);
    const { trade, items } = await loadPending(tx, leagueId, tradeId);
    if (!team || trade.receiverTeamId !== team.id) throw new GameError("Só o time que recebeu a proposta pode aceitá-la");
    if (league.tradeReviewHours > 0) {
      const reason = await revalidate(tx, trade, items, window);
      if (reason) {
        await tx.update(trades).set({ status: "FAILED", failReason: reason, respondedAt: now }).where(eq(trades.id, tradeId));
        return { failure: reason };
      }
      const reviewEndsAt = new Date(now.getTime() + league.tradeReviewHours * 3_600_000);
      await tx.update(trades).set({ status: "REVIEW", respondedAt: now, reviewEndsAt }).where(eq(trades.id, tradeId));
      return { status: "REVIEW" as const, reviewEndsAt };
    }
    if (window.locked) throw new GameError("Rodada travada: aceite quando a rodada for fechada");
    const failure = await executeTrade(tx, trade, items, window, now);
    return failure ? { failure } : { status: "ACCEPTED" as const, reviewEndsAt: null };
  });
  if ("failure" in outcome) throw new GameError(`A troca não pôde ser concluída: ${outcome.failure}`);
  return outcome;
}

async function assertCommissioner(db: DbOrTx, leagueId: number, userId: number) {
  const [league] = await db.select().from(leagues).where(eq(leagues.id, leagueId));
  if (!league || league.commissionerId !== userId) throw new GameError("Só o comissário pode fazer isso");
}

/** Comissário: veta uma proposta pendente ou uma troca em revisão. */
export async function vetoTrade(db: Db, leagueId: number, userId: number, tradeId: number, reason: string, now: Date) {
  await assertCommissioner(db, leagueId, userId);
  await loadTrade(db, leagueId, tradeId, ["PENDING", "REVIEW"]);
  const note = reason.trim();
  await db
    .update(trades)
    .set({ status: "VETOED", failReason: note ? `Vetada pelo comissário: ${note}` : "Vetada pelo comissário", respondedAt: now, reviewEndsAt: null })
    .where(eq(trades.id, tradeId));
}

/** Comissário: aprova uma troca em revisão sem esperar o prazo. */
export async function approveTrade(db: Db, leagueId: number, userId: number, tradeId: number, now: Date) {
  await assertCommissioner(db, leagueId, userId);
  const window = await tradeWindow(db, now);
  if (window.locked) throw new GameError("Rodada travada: aprove quando a rodada for fechada");
  const failure = await db.transaction(async (tx) => {
    await lockLeagueRow(tx, leagueId);
    const { trade, items } = await loadTrade(tx, leagueId, tradeId, ["REVIEW"]);
    return executeTrade(tx, trade, items, window, now);
  });
  if (failure) throw new GameError(`A troca não pôde ser concluída: ${failure}`);
}

/** Job agendado: conclui as trocas cujo prazo de revisão venceu (espera a rodada destravar). */
export async function processTradeReviews(db: Db, now: Date): Promise<{ message: string } | null> {
  const due = await db.select().from(trades).where(and(eq(trades.status, "REVIEW"), lte(trades.reviewEndsAt, now)));
  if (due.length === 0) return null;
  const window = await tradeWindow(db, now);
  if (window.locked) return { message: `${due.length} troca(s) aguardando a rodada destravar` };
  let done = 0;
  for (const t of due) {
    const failure = await db.transaction(async (tx) => {
      await lockLeagueRow(tx, t.leagueId);
      const { trade, items } = await loadTrade(tx, t.leagueId, t.id, ["REVIEW"]);
      return executeTrade(tx, trade, items, window, now);
    });
    if (!failure) done++;
  }
  return { message: `${done} troca(s) concluída(s) após a revisão, ${due.length - done} não concluída(s)` };
}

/** Propostas pendentes e trocas em revisão da liga (painel do comissário). */
export async function leagueOpenTrades(db: DbOrTx, leagueId: number) {
  const list = await db
    .select()
    .from(trades)
    .where(and(eq(trades.leagueId, leagueId), inArray(trades.status, ["PENDING", "REVIEW"])))
    .orderBy(desc(trades.id));
  return withItems(db, list);
}

/** Outras propostas (pendentes ou em revisão) com jogadores que acabaram de mudar de time deixam de valer. */
async function failStaleTrades(tx: DbOrTx, leagueId: number, movedPlayerIds: readonly number[], now: Date) {
  if (movedPlayerIds.length === 0) return;
  const stale = await tx
    .selectDistinct({ id: trades.id })
    .from(trades)
    .innerJoin(tradeItems, eq(tradeItems.tradeId, trades.id))
    .where(
      and(eq(trades.leagueId, leagueId), inArray(trades.status, ["PENDING", "REVIEW"]), inArray(tradeItems.playerId, [...movedPlayerIds])),
    );
  if (stale.length === 0) return;
  await tx
    .update(trades)
    .set({ status: "FAILED", failReason: "Um dos jogadores já mudou de time", respondedAt: now, reviewEndsAt: null })
    .where(inArray(trades.id, stale.map((s) => s.id)));
}

export async function rejectTrade(db: Db, leagueId: number, userId: number, tradeId: number, now: Date) {
  const team = await teamOf(db, leagueId, userId);
  const { trade } = await loadPending(db, leagueId, tradeId);
  if (!team || trade.receiverTeamId !== team.id) throw new GameError("Só o time que recebeu a proposta pode recusá-la");
  await db.update(trades).set({ status: "REJECTED", respondedAt: now }).where(eq(trades.id, tradeId));
}

export async function cancelTrade(db: Db, leagueId: number, userId: number, tradeId: number, now: Date) {
  const team = await teamOf(db, leagueId, userId);
  const { trade } = await loadPending(db, leagueId, tradeId);
  if (!team || trade.proposerTeamId !== team.id) throw new GameError("Só quem propôs pode cancelar");
  await db.update(trades).set({ status: "CANCELLED", respondedAt: now }).where(eq(trades.id, tradeId));
}

/** Propostas que envolvem o time (enviadas e recebidas), com os jogadores de cada lado. */
export async function teamTrades(db: DbOrTx, leagueId: number, teamId: number, limit = 30) {
  const list = await db
    .select()
    .from(trades)
    .where(and(eq(trades.leagueId, leagueId), or(eq(trades.proposerTeamId, teamId), eq(trades.receiverTeamId, teamId))))
    .orderBy(desc(trades.id))
    .limit(limit);
  return withItems(db, list);
}

async function withItems(db: DbOrTx, list: Trade[]) {
  if (list.length === 0) return [];
  const items = await db
    .select({ tradeId: tradeItems.tradeId, fromTeamId: tradeItems.fromTeamId, playerId: players.id, name: players.name, position: players.position })
    .from(tradeItems)
    .innerJoin(players, eq(players.id, tradeItems.playerId))
    .where(inArray(tradeItems.tradeId, list.map((t) => t.id)));
  return list.map((t) => ({ ...t, items: items.filter((i) => i.tradeId === t.id) }));
}

export async function pendingTradesFor(db: DbOrTx, leagueId: number, teamId: number) {
  return db
    .select({ id: trades.id })
    .from(trades)
    .where(and(eq(trades.leagueId, leagueId), eq(trades.receiverTeamId, teamId), eq(trades.status, "PENDING")));
}
