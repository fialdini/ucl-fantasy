import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, isNull, notInArray, sql } from "drizzle-orm";
import { game } from "@config/game";
import type { Db, DbOrTx, Tx } from "@/db/client";
import {
  clubs,
  draftPicks,
  fantasyTeams,
  leagueMembers,
  leagues,
  playerMatchStats,
  players,
  rosterSlots,
  rounds,
  waiverClaims,
} from "@/db/schema";
import { autoPick, cannotPick, shuffle, snakeOrder, type DraftCandidate } from "@/domain/draft";
import { currentRound, isRoundLocked, lineupLockState } from "@/domain/lock";
import { cannotReplace, initialSlots, validateLineup } from "@/domain/roster";
import { createRegularSchedule } from "./season";

/** Erro de regra do jogo, com mensagem para o usuário. */
export class GameError extends Error {}

// ---------- Liga ----------

function inviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(6), (b) => alphabet[b % alphabet.length]).join("");
}

export async function createLeague(
  db: Db,
  input: { userId: number; name: string; teamName: string; maxTeams: number },
) {
  const name = input.name.trim();
  if (!name) throw new GameError("Dê um nome à liga");
  if (input.maxTeams < game.league.minTeams || input.maxTeams > game.league.maxTeams) {
    throw new GameError(`A liga deve ter de ${game.league.minTeams} a ${game.league.maxTeams} times`);
  }
  const allRounds = await db.select().from(rounds);
  const round = currentRound(allRounds);
  if (!round || round.order > game.season.regularSeasonLastRound) {
    throw new GameError("A temporada regular fantasy já terminou — não é possível criar ligas agora");
  }
  return db.transaction(async (tx) => {
    const [league] = await tx
      .insert(leagues)
      .values({
        name,
        inviteCode: inviteCode(),
        commissionerId: input.userId,
        maxTeams: input.maxTeams,
        startRound: round.order,
      })
      .returning();
    await tx.insert(leagueMembers).values({ leagueId: league!.id, userId: input.userId, role: "COMMISSIONER" });
    await tx.insert(fantasyTeams).values({ leagueId: league!.id, userId: input.userId, name: input.teamName.trim() || "Meu time" });
    return league!;
  });
}

export async function joinLeague(db: Db, input: { userId: number; code: string; teamName: string }) {
  const [league] = await db.select().from(leagues).where(eq(leagues.inviteCode, input.code.trim().toUpperCase()));
  if (!league) throw new GameError("Código de convite inválido");
  if (league.status !== "SETUP") throw new GameError("O draft desta liga já começou");
  return db.transaction(async (tx) => {
    const [{ n }] = (await tx.select({ n: count() }).from(fantasyTeams).where(eq(fantasyTeams.leagueId, league.id))) as [
      { n: number },
    ];
    const [already] = await tx
      .select()
      .from(leagueMembers)
      .where(and(eq(leagueMembers.leagueId, league.id), eq(leagueMembers.userId, input.userId)));
    if (already) return league;
    if (n >= league.maxTeams) throw new GameError("A liga está cheia");
    await tx.insert(leagueMembers).values({ leagueId: league.id, userId: input.userId, role: "MEMBER" });
    await tx.insert(fantasyTeams).values({ leagueId: league.id, userId: input.userId, name: input.teamName.trim() || "Meu time" });
    return league;
  });
}

export async function teamOf(db: DbOrTx, leagueId: number, userId: number) {
  const [team] = await db
    .select()
    .from(fantasyTeams)
    .where(and(eq(fantasyTeams.leagueId, leagueId), eq(fantasyTeams.userId, userId)));
  return team ?? null;
}

// ---------- Draft ----------

export async function startDraft(db: Db, leagueId: number, userId: number, now: Date, random: () => number = Math.random) {
  const [league] = await db.select().from(leagues).where(eq(leagues.id, leagueId));
  if (!league) throw new GameError("Liga não encontrada");
  if (league.commissionerId !== userId) throw new GameError("Só o comissário pode iniciar o draft");
  if (league.status !== "SETUP") throw new GameError("O draft já foi iniciado");
  const teams = await db.select({ id: fantasyTeams.id }).from(fantasyTeams).where(eq(fantasyTeams.leagueId, leagueId));
  if (teams.length < game.league.minTeams) throw new GameError(`São necessários pelo menos ${game.league.minTeams} times`);
  await db
    .update(leagues)
    .set({
      status: "DRAFTING",
      draftOrder: shuffle(
        teams.map((t) => t.id),
        random,
      ),
      draftCurrentPick: 0,
      draftPickDeadline: new Date(now.getTime() + game.draft.pickSeconds * 1000),
    })
    .where(eq(leagues.id, leagueId));
}

/** Ranking do auto-pick: pontos na temporada, depois média; só jogadores ativos de clubes vivos e livres na liga. */
export async function rankedAvailable(db: DbOrTx, leagueId: number, limit = 5000) {
  const owned = db.select({ id: rosterSlots.playerId }).from(rosterSlots).where(eq(rosterSlots.leagueId, leagueId));
  const totals = db
    .select({
      playerId: playerMatchStats.playerId,
      total: sql<number>`sum(${playerMatchStats.points})`.as("total"),
      games: sql<number>`count(*) filter (where ${playerMatchStats.minutes} > 0)`.as("games"),
    })
    .from(playerMatchStats)
    .groupBy(playerMatchStats.playerId)
    .as("totals");
  return db
    .select({
      playerId: players.id,
      name: players.name,
      position: players.position,
      clubId: players.clubId,
      clubName: clubs.shortName,
      total: sql<number>`coalesce(${totals.total}, 0)`.mapWith(Number),
      games: sql<number>`coalesce(${totals.games}, 0)`.mapWith(Number),
    })
    .from(players)
    .innerJoin(clubs, eq(clubs.id, players.clubId))
    .leftJoin(totals, eq(totals.playerId, players.id))
    .where(and(eq(players.active, true), isNull(clubs.eliminatedAfterRound), notInArray(players.id, owned)))
    .orderBy(desc(sql`coalesce(${totals.total}, 0)`), desc(sql`coalesce(${totals.games}, 0)`), asc(players.id))
    .limit(limit);
}

async function lockLeague(tx: Tx, leagueId: number) {
  const [league] = await tx.select().from(leagues).where(eq(leagues.id, leagueId)).for("update");
  if (!league) throw new GameError("Liga não encontrada");
  return league;
}

async function teamRoster(tx: DbOrTx, teamId: number): Promise<DraftCandidate[]> {
  return tx
    .select({ playerId: rosterSlots.playerId, position: players.position, clubId: players.clubId })
    .from(rosterSlots)
    .innerJoin(players, eq(players.id, rosterSlots.playerId))
    .where(eq(rosterSlots.teamId, teamId));
}

async function insertPick(tx: Tx, league: typeof leagues.$inferSelect, teamId: number, playerId: number, auto: boolean, now: Date) {
  const order = league.draftOrder ?? [];
  const overall = league.draftCurrentPick ?? 0;
  await tx.insert(draftPicks).values({
    leagueId: league.id,
    overall,
    round: Math.floor(overall / order.length) + 1,
    teamId,
    playerId,
    auto,
    pickedAt: now,
  });
  // Titular/banco são definidos ao fim do draft; até lá todos ficam como BENCH.
  await tx.insert(rosterSlots).values({ leagueId: league.id, teamId, playerId, slot: "BENCH", acquiredVia: "DRAFT", acquiredAt: now });
  const next = overall + 1;
  const total = order.length * game.roster.size;
  if (next >= total) {
    await completeDraft(tx, league.id, now);
    return;
  }
  // O prazo do próximo pick conta a partir do pick anterior (picks automáticos encadeiam no tempo).
  const base = auto && league.draftPickDeadline ? league.draftPickDeadline : now;
  const deadline = new Date(base.getTime() + game.draft.pickSeconds * 1000);
  await tx.update(leagues).set({ draftCurrentPick: next, draftPickDeadline: deadline }).where(eq(leagues.id, league.id));
  league.draftCurrentPick = next;
  league.draftPickDeadline = deadline;
}

async function completeDraft(tx: Tx, leagueId: number, now: Date) {
  const picks = await tx
    .select({ teamId: draftPicks.teamId, playerId: draftPicks.playerId, position: players.position })
    .from(draftPicks)
    .innerJoin(players, eq(players.id, draftPicks.playerId))
    .where(eq(draftPicks.leagueId, leagueId))
    .orderBy(asc(draftPicks.overall));
  const byTeam = new Map<number, typeof picks>();
  for (const p of picks) byTeam.set(p.teamId, [...(byTeam.get(p.teamId) ?? []), p]);
  for (const [teamId, teamPicks] of byTeam) {
    for (const [playerId, slot] of initialSlots(teamPicks)) {
      await tx
        .update(rosterSlots)
        .set({ slot })
        .where(and(eq(rosterSlots.teamId, teamId), eq(rosterSlots.playerId, playerId)));
    }
  }
  // A liga começa na primeira rodada ainda não travada.
  const allRounds = await tx.select().from(rounds);
  const firstOpen = allRounds
    .filter((r) => r.closedAt === null && !isRoundLocked(r, now))
    .sort((a, b) => a.order - b.order)[0];
  const [league] = await tx.select().from(leagues).where(eq(leagues.id, leagueId));
  const startRound = Math.max(league!.startRound, firstOpen?.order ?? league!.startRound);
  await tx
    .update(leagues)
    .set({ status: "ACTIVE", draftCurrentPick: null, draftPickDeadline: null, startRound })
    .where(eq(leagues.id, leagueId));
  await createRegularSchedule(tx, leagueId, startRound);
}

/** Executa auto-picks de todos os prazos já vencidos. Seguro para chamar a cada polling. */
export async function advanceDraft(db: Db, leagueId: number, now: Date) {
  return db.transaction(async (tx) => {
    const league = await lockLeague(tx, leagueId);
    let made = 0;
    while (
      league.status === "DRAFTING" &&
      league.draftPickDeadline &&
      league.draftPickDeadline.getTime() <= now.getTime() &&
      league.draftCurrentPick !== null
    ) {
      const teamId = snakeOrder(league.draftOrder ?? [])[league.draftCurrentPick]!;
      const roster = await teamRoster(tx, teamId);
      const ranked = await rankedAvailable(tx, leagueId);
      const choice = autoPick(roster, ranked, new Set(), game.roster.clubCap(league.startRound));
      if (!choice) throw new GameError("Não há jogadores disponíveis para o auto-pick");
      await insertPick(tx, league, teamId, choice.playerId, true, now);
      made++;
      const [fresh] = await tx.select().from(leagues).where(eq(leagues.id, leagueId));
      Object.assign(league, fresh);
    }
    return made;
  });
}

export async function makePick(db: Db, leagueId: number, userId: number, playerId: number, now: Date) {
  await advanceDraft(db, leagueId, now);
  await db.transaction(async (tx) => {
    const league = await lockLeague(tx, leagueId);
    if (league.status !== "DRAFTING" || league.draftCurrentPick === null) throw new GameError("O draft não está em andamento");
    const teamId = snakeOrder(league.draftOrder ?? [])[league.draftCurrentPick]!;
    const team = await teamOf(tx, leagueId, userId);
    if (!team || team.id !== teamId) throw new GameError("Não é a sua vez");
    const [player] = await tx
      .select({ playerId: players.id, position: players.position, clubId: players.clubId, active: players.active, eliminated: clubs.eliminatedAfterRound })
      .from(players)
      .innerJoin(clubs, eq(clubs.id, players.clubId))
      .where(eq(players.id, playerId));
    if (!player || !player.active || player.eliminated !== null) throw new GameError("Jogador indisponível");
    const [owned] = await tx
      .select()
      .from(rosterSlots)
      .where(and(eq(rosterSlots.leagueId, leagueId), eq(rosterSlots.playerId, playerId)));
    const reason = cannotPick(await teamRoster(tx, teamId), player, owned ? new Set([playerId]) : new Set(), game.roster.clubCap(league.startRound));
    if (reason) throw new GameError(reason);
    await insertPick(tx, league, teamId, playerId, false, now);
  });
}

// ---------- Escalação e mercado ----------

async function assertUnlocked(db: DbOrTx, now: Date) {
  const state = lineupLockState(await db.select().from(rounds), now);
  if (state.locked) throw new GameError(state.reason);
  return state.round;
}

export async function setLineup(db: Db, leagueId: number, userId: number, starterIds: readonly number[], now: Date) {
  await assertUnlocked(db, now);
  const team = await teamOf(db, leagueId, userId);
  if (!team) throw new GameError("Você não tem time nesta liga");
  const roster = await db
    .select({ playerId: rosterSlots.playerId, position: players.position, clubId: players.clubId })
    .from(rosterSlots)
    .innerJoin(players, eq(players.id, rosterSlots.playerId))
    .where(eq(rosterSlots.teamId, team.id));
  const starters = new Set(starterIds);
  const proposal = roster.map((p) => ({ ...p, slot: starters.has(p.playerId) ? ("STARTER" as const) : ("BENCH" as const) }));
  const reason = validateLineup(proposal);
  if (reason) throw new GameError(reason);
  await db.transaction(async (tx) => {
    for (const p of proposal) {
      await tx.update(rosterSlots).set({ slot: p.slot }).where(and(eq(rosterSlots.teamId, team.id), eq(rosterSlots.playerId, p.playerId)));
    }
  });
}

async function marketChecks(db: DbOrTx, leagueId: number, userId: number, addPlayerId: number, dropPlayerId: number, roundOrder: number) {
  const team = await teamOf(db, leagueId, userId);
  if (!team) throw new GameError("Você não tem time nesta liga");
  const [add] = await db
    .select({ position: players.position, clubId: players.clubId, active: players.active, eliminated: clubs.eliminatedAfterRound })
    .from(players)
    .innerJoin(clubs, eq(clubs.id, players.clubId))
    .where(eq(players.id, addPlayerId));
  if (!add || !add.active) throw new GameError("Jogador fora da lista inscrita");
  if (add.eliminated !== null) throw new GameError("Clube do jogador foi eliminado");
  const roster = await teamRoster(db, team.id);
  const reason = cannotReplace(roster, dropPlayerId, add, game.roster.clubCap(roundOrder));
  if (reason) throw new GameError(reason);
  return team;
}

/** Free agent: troca imediata, só fora de janela de waiver e com a rodada destravada. */
export async function addFreeAgent(db: Db, leagueId: number, userId: number, addPlayerId: number, dropPlayerId: number, now: Date) {
  const round = await assertUnlocked(db, now);
  const [league] = await db.select().from(leagues).where(eq(leagues.id, leagueId));
  if (league?.status !== "ACTIVE") throw new GameError("A liga não está ativa");
  if (league.waiverProcessAt) throw new GameError("Janela de waiver aberta: faça um pedido de waiver");
  const team = await marketChecks(db, leagueId, userId, addPlayerId, dropPlayerId, round?.order ?? 1);
  try {
    await db
      .update(rosterSlots)
      .set({ playerId: addPlayerId, acquiredVia: "FREE_AGENT", acquiredAt: now })
      .where(and(eq(rosterSlots.teamId, team.id), eq(rosterSlots.playerId, dropPlayerId)));
  } catch {
    // índice único (liga, jogador): alguém pegou antes
    throw new GameError("Jogador já pertence a outro time");
  }
}

export async function createWaiverClaim(db: Db, leagueId: number, userId: number, addPlayerId: number, dropPlayerId: number, now: Date) {
  const round = await assertUnlocked(db, now);
  const [league] = await db.select().from(leagues).where(eq(leagues.id, leagueId));
  if (!league?.waiverProcessAt) throw new GameError("Não há janela de waiver aberta: contrate como free agent");
  const team = await marketChecks(db, leagueId, userId, addPlayerId, dropPlayerId, round?.order ?? 1);
  const [owned] = await db
    .select()
    .from(rosterSlots)
    .where(and(eq(rosterSlots.leagueId, leagueId), eq(rosterSlots.playerId, addPlayerId)));
  if (owned) throw new GameError("Jogador já pertence a outro time");
  const [{ n }] = (await db
    .select({ n: count() })
    .from(waiverClaims)
    .where(and(eq(waiverClaims.teamId, team.id), eq(waiverClaims.status, "PENDING")))) as [{ n: number }];
  await db.insert(waiverClaims).values({ leagueId, teamId: team.id, addPlayerId, dropPlayerId, preference: n + 1 });
}

export async function cancelWaiverClaim(db: Db, leagueId: number, userId: number, claimId: number) {
  const team = await teamOf(db, leagueId, userId);
  if (!team) throw new GameError("Você não tem time nesta liga");
  await db
    .update(waiverClaims)
    .set({ status: "CANCELLED" })
    .where(and(eq(waiverClaims.id, claimId), eq(waiverClaims.teamId, team.id), eq(waiverClaims.status, "PENDING")));
}
