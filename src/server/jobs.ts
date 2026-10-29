import { and, desc, eq, inArray, isNull, lte, ne, notInArray, sql } from "drizzle-orm";
import { competitionRounds, game } from "@config/game";
import type { Db, DbOrTx } from "@/db/client";
import {
  clubs,
  fantasyTeams,
  leagues,
  lineupSnapshots,
  matches,
  matchups,
  playerMatchStats,
  players,
  rosterSlots,
  rounds,
  syncLogs,
  waiverClaims,
} from "@/db/schema";
import { isRoundLocked, currentRound } from "@/domain/lock";
import { matchupWinner, waiverOrder } from "@/domain/matchup";
import {
  knockoutLosers,
  leagueStageEliminated,
  roundCloseReadiness,
  waiverWindowAfter,
} from "@/domain/roundClose";
import { computePoints, deriveRawStats } from "@/domain/scoring";
import type { MatchDetail } from "@/domain/types";
import { resolveWaivers } from "@/domain/waivers";
import type { FootballDataProvider } from "@/providers/types";
import { advancePlayoffs, leagueStandings } from "./season";
import { teamSpanScore } from "./teamScore";

export interface JobContext {
  db: Db;
  provider: FootballDataProvider;
  now: Date;
}

type JobResult = { message: string; details?: Record<string, unknown>; status?: "SUCCESS" | "PARTIAL" };

/** Executa um job registrando início, fim, requisições e erro no SyncLog. Erros não derrubam os demais jobs. */
export async function withSyncLog(ctx: JobContext, job: string, fn: () => Promise<JobResult>) {
  const before = ctx.provider.requestCount();
  const [log] = await ctx.db
    .insert(syncLogs)
    .values({ job, provider: ctx.provider.name, status: "RUNNING", startedAt: new Date() })
    .returning({ id: syncLogs.id });
  try {
    const result = await fn();
    await ctx.db
      .update(syncLogs)
      .set({
        status: result.status ?? "SUCCESS",
        finishedAt: new Date(),
        requests: ctx.provider.requestCount() - before,
        message: result.message,
        details: result.details ?? null,
      })
      .where(eq(syncLogs.id, log!.id));
    return { ok: true as const, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.db
      .update(syncLogs)
      .set({ status: "ERROR", finishedAt: new Date(), requests: ctx.provider.requestCount() - before, message })
      .where(eq(syncLogs.id, log!.id));
    return { ok: false as const, message };
  }
}

async function lastSuccess(db: Db, job: string): Promise<Date | null> {
  const [row] = await db
    .select({ finishedAt: syncLogs.finishedAt })
    .from(syncLogs)
    .where(and(eq(syncLogs.job, job), eq(syncLogs.status, "SUCCESS")))
    .orderBy(desc(syncLogs.id))
    .limit(1);
  return row?.finishedAt ?? null;
}

// ---------- Calendário e elencos ----------

export async function syncCalendar(ctx: JobContext): Promise<JobResult> {
  const { db, provider } = ctx;
  const fixtures = await provider.getFixtures();
  const clubIds = new Set(fixtures.flatMap((f) => [f.homeClubId, f.awayClubId]));
  const providerClubs = new Map((await provider.getClubs()).map((c) => [c.id, c]));
  for (const id of clubIds) {
    const c = providerClubs.get(id) ?? { id, name: `Clube ${id}`, shortName: String(id), logoUrl: null };
    await db
      .insert(clubs)
      .values(c)
      .onConflictDoUpdate({ target: clubs.id, set: { name: c.name, shortName: c.shortName, logoUrl: c.logoUrl } });
  }
  for (const r of competitionRounds) {
    const kickoffs = fixtures.filter((f) => f.roundOrder === r.order).map((f) => f.kickoff.getTime());
    const firstKickoff = kickoffs.length ? new Date(Math.min(...kickoffs)) : null;
    const lastKickoff = kickoffs.length ? new Date(Math.max(...kickoffs)) : null;
    await db
      .insert(rounds)
      .values({ ...r, firstKickoff, lastKickoff })
      .onConflictDoUpdate({ target: rounds.order, set: { firstKickoff, lastKickoff, name: r.name } });
  }
  for (const f of fixtures) {
    const values = {
      roundOrder: f.roundOrder,
      homeClubId: f.homeClubId,
      awayClubId: f.awayClubId,
      kickoff: f.kickoff,
      status: f.status,
      homeGoals: f.homeGoals,
      awayGoals: f.awayGoals,
      homePenalties: f.homePenalties,
      awayPenalties: f.awayPenalties,
    };
    await db.insert(matches).values({ id: f.id, ...values }).onConflictDoUpdate({ target: matches.id, set: values });
  }
  return { message: `${fixtures.length} partidas, ${clubIds.size} clubes` };
}

export async function syncSquads(ctx: JobContext): Promise<JobResult> {
  const { db, provider } = ctx;
  const clubRows = await db.select({ id: clubs.id }).from(clubs);
  const seen = new Set<number>();
  const failed: number[] = [];
  for (const club of clubRows) {
    try {
      const squad = await provider.getSquad(club.id);
      for (const p of squad) {
        seen.add(p.id);
        const values = {
          name: p.name,
          position: p.position,
          clubId: p.clubId,
          photoUrl: p.photoUrl,
          injured: p.injured,
          active: true,
          updatedAt: new Date(),
        };
        await db.insert(players).values({ id: p.id, ...values }).onConflictDoUpdate({ target: players.id, set: values });
      }
    } catch {
      failed.push(club.id);
    }
  }
  // Quem sumiu de todos os elencos (transferido para fora da competição/desligado) fica inativo.
  let deactivated = 0;
  if (failed.length === 0 && seen.size > 0) {
    const rows = await db
      .update(players)
      .set({ active: false })
      .where(and(eq(players.active, true), notInArray(players.id, [...seen])))
      .returning({ id: players.id });
    deactivated = rows.length;
  }
  return {
    message: `${seen.size} jogadores em ${clubRows.length - failed.length} clubes; ${deactivated} inativados`,
    details: failed.length ? { failedClubs: failed } : undefined,
    status: failed.length ? "PARTIAL" : "SUCCESS",
  };
}

// ---------- Estatísticas e pontos ----------

/** Jogador que aparece na súmula sem estar no cadastro (inscrito tarde) entra com a posição da súmula. */
async function registerNewPlayers(db: DbOrTx, detail: MatchDetail) {
  const candidates = detail.players.filter((p) => p.position);
  if (candidates.length === 0) return;
  const clubIds = new Set((await db.select({ id: clubs.id }).from(clubs)).map((c) => c.id));
  const rows = candidates
    .filter((p) => clubIds.has(p.clubId))
    .map((p) => ({ id: p.playerId, name: p.name, position: p.position!, clubId: p.clubId }));
  if (rows.length) await db.insert(players).values(rows).onConflictDoNothing({ target: players.id });
}

async function storeMatchStats(db: DbOrTx, detail: MatchDetail, final: boolean): Promise<{ unknownPlayers: number }> {
  await registerNewPlayers(db, detail);
  const ids = detail.players.map((p) => p.playerId);
  const known = ids.length
    ? await db.select({ id: players.id, position: players.position }).from(players).where(inArray(players.id, ids))
    : [];
  const positionOf = new Map(known.map((p) => [p.id, p.position]));
  const [match] = await db.select().from(matches).where(eq(matches.id, detail.matchId));
  if (!match) return { unknownPlayers: 0 };
  const derived = deriveRawStats(detail);
  await db.delete(playerMatchStats).where(eq(playerMatchStats.matchId, detail.matchId));
  const rows = [...derived].flatMap(([playerId, { clubId, stats }]) => {
    const position = positionOf.get(playerId);
    if (!position) return [];
    const score = computePoints(position, stats);
    return [
      {
        playerId,
        matchId: detail.matchId,
        roundOrder: match.roundOrder,
        clubId,
        position,
        ...stats,
        cleanSheet: score.cleanSheet,
        points: score.points,
        breakdown: score.breakdown,
        final,
      },
    ];
  });
  if (rows.length) await db.insert(playerMatchStats).values(rows);
  await db
    .update(matches)
    .set({
      statsStatus: final ? "FINAL" : "PARTIAL",
      statsFetchedAt: new Date(),
      statsError: null,
      homeGoals: detail.homeGoals ?? match.homeGoals,
      awayGoals: detail.awayGoals ?? match.awayGoals,
    })
    .where(eq(matches.id, detail.matchId));
  return { unknownPlayers: ids.length - known.length };
}

/**
 * Busca estatísticas das partidas encerradas. Sem dado oficial, a partida continua "aguardando"
 * (statsStatus NONE) — nunca se pontua com dado incompleto.
 */
export async function syncMatchStats(
  ctx: JobContext,
  options: { matchIds?: number[]; fresh?: boolean; final?: boolean } = {},
): Promise<JobResult & { missing: number[] }> {
  const { db, provider } = ctx;
  const targets = options.matchIds
    ? await db.select().from(matches).where(and(inArray(matches.id, options.matchIds), eq(matches.status, "FINISHED")))
    : await db.select().from(matches).where(and(eq(matches.status, "FINISHED"), eq(matches.statsStatus, "NONE")));
  if (targets.length === 0) return { message: "Nenhuma partida pendente", missing: [] };
  const details = await provider.getMatchDetails(
    targets.map((m) => m.id),
    { fresh: options.fresh },
  );
  const byId = new Map(details.map((d) => [d.matchId, d]));
  const missing: number[] = [];
  let unknownPlayers = 0;
  for (const m of targets) {
    const detail = byId.get(m.id);
    if (!detail || detail.players.length === 0) {
      missing.push(m.id);
      await db.update(matches).set({ statsError: "Aguardando dados oficiais" }).where(eq(matches.id, m.id));
      continue;
    }
    unknownPlayers += (await storeMatchStats(db, detail, options.final ?? false)).unknownPlayers;
  }
  return {
    message: `${targets.length - missing.length}/${targets.length} partidas com estatísticas`,
    details: { pendingMatches: missing, unknownPlayers },
    status: missing.length ? "PARTIAL" : "SUCCESS",
    missing,
  };
}

/** Recalcula pontos a partir das estatísticas salvas (após mudar a tabela de pontuação). Não chama a API. */
export async function recalcPoints(db: Db, roundOrder?: number): Promise<JobResult> {
  const rows = await db
    .select({ stat: playerMatchStats, position: players.position })
    .from(playerMatchStats)
    .innerJoin(players, eq(players.id, playerMatchStats.playerId))
    .where(roundOrder === undefined ? undefined : eq(playerMatchStats.roundOrder, roundOrder));
  for (const { stat, position } of rows) {
    const score = computePoints(position, stat);
    await db
      .update(playerMatchStats)
      .set({ position, points: score.points, breakdown: score.breakdown, cleanSheet: score.cleanSheet })
      .where(and(eq(playerMatchStats.playerId, stat.playerId), eq(playerMatchStats.matchId, stat.matchId)));
  }
  const affected = new Set(rows.map((r) => r.stat.roundOrder));
  for (const order of affected) await updateMatchupScores(db, order);
  return { message: `${rows.length} linhas recalculadas` };
}

// ---------- Escalações e confrontos ----------

/** Congela a escalação de todos os times nas rodadas já travadas. */
export async function ensureLineupSnapshots(db: DbOrTx, now: Date, onlyRound?: number) {
  const allRounds = await db.select().from(rounds);
  const locked = allRounds.filter((r) => (onlyRound === undefined || r.order === onlyRound) && isRoundLocked(r, now));
  let created = 0;
  for (const round of locked) {
    const teams = await db
      .select({ id: fantasyTeams.id })
      .from(fantasyTeams)
      .innerJoin(leagues, eq(leagues.id, fantasyTeams.leagueId))
      .where(and(eq(leagues.status, "ACTIVE"), lte(leagues.startRound, round.order)));
    for (const team of teams) {
      const [existing] = await db
        .select({ playerId: lineupSnapshots.playerId })
        .from(lineupSnapshots)
        .where(and(eq(lineupSnapshots.teamId, team.id), eq(lineupSnapshots.roundOrder, round.order)))
        .limit(1);
      if (existing) continue;
      const slots = await db.select().from(rosterSlots).where(eq(rosterSlots.teamId, team.id));
      if (slots.length === 0) continue;
      await db
        .insert(lineupSnapshots)
        .values(slots.map((s) => ({ teamId: team.id, roundOrder: round.order, playerId: s.playerId, slot: s.slot })));
      created++;
    }
  }
  return created;
}

/** Atualiza placares (parciais) dos confrontos que incluem a rodada. */
export async function updateMatchupScores(db: DbOrTx, roundOrder: number) {
  const open = await db
    .select()
    .from(matchups)
    .where(and(lte(matchups.fromRound, roundOrder), sql`${matchups.toRound} >= ${roundOrder}`, ne(matchups.status, "FINAL")));
  for (const m of open) {
    const home = await teamSpanScore(db, m.homeTeamId, m.fromRound, m.toRound);
    const away = await teamSpanScore(db, m.awayTeamId, m.fromRound, m.toRound);
    await db
      .update(matchups)
      .set({ homePoints: home.points, awayPoints: away.points, status: home.started || away.started ? "PARTIAL" : "SCHEDULED" })
      .where(eq(matchups.id, m.id));
  }
  return open.length;
}

// ---------- Fechamento de rodada ----------

export async function closeRound(ctx: JobContext, order: number): Promise<JobResult & { closed: boolean }> {
  const { db, provider, now } = ctx;
  const [round] = await db.select().from(rounds).where(eq(rounds.order, order));
  if (!round) return { message: `Rodada ${order} inexistente`, closed: false };
  if (round.closedAt) return { message: `Rodada ${order} já fechada`, closed: false };
  const roundMatches = await db.select().from(matches).where(eq(matches.roundOrder, order));
  const readiness = roundCloseReadiness(roundMatches, now);
  if (!readiness.ready) {
    return { message: readiness.reason ?? "Não pronta", closed: false, details: { pendingMatches: readiness.pendingMatchIds } };
  }

  // Reprocessa todas as partidas uma última vez (a fonte corrige dados depois do jogo).
  const finished = roundMatches.filter((m) => m.status === "FINISHED").map((m) => m.id);
  const stats = await syncMatchStats(ctx, { matchIds: finished, fresh: true, final: true });
  if (stats.missing.length > 0) {
    return {
      message: `Aguardando dados oficiais de ${stats.missing.length} partida(s)`,
      closed: false,
      status: "PARTIAL",
      details: { pendingMatches: stats.missing },
    };
  }

  const eliminated = await eliminationsAfter(ctx, order);
  const finalized: number[] = [];
  await db.transaction(async (tx) => {
    await ensureLineupSnapshots(tx, now, order);
    if (eliminated.length) {
      await tx
        .update(clubs)
        .set({ eliminatedAfterRound: order })
        .where(and(inArray(clubs.id, eliminated), isNull(clubs.eliminatedAfterRound)));
    }
    await updateMatchupScores(tx, order);
    const ending = await tx.select().from(matchups).where(and(eq(matchups.toRound, order), ne(matchups.status, "FINAL")));
    for (const m of ending) {
      const home = await teamSpanScore(tx, m.homeTeamId, m.fromRound, m.toRound);
      const away = await teamSpanScore(tx, m.awayTeamId, m.fromRound, m.toRound);
      // Nos playoffs o mandante é sempre a melhor campanha.
      const winner = matchupWinner(m, home.points, away.points, new Map([[m.homeTeamId, 1], [m.awayTeamId, 2]]));
      await tx
        .update(matchups)
        .set({ homePoints: home.points, awayPoints: away.points, status: "FINAL", winnerTeamId: winner })
        .where(eq(matchups.id, m.id));
      finalized.push(m.id);
    }
    await tx.update(rounds).set({ closedAt: now }).where(eq(rounds.order, order));

    const active = await tx.select().from(leagues).where(and(eq(leagues.status, "ACTIVE"), lte(leagues.startRound, order)));
    for (const league of active) {
      const outcome = await advancePlayoffs(tx, league.id, order);
      if (outcome === "COMPLETE") {
        await tx.update(leagues).set({ status: "COMPLETE", waiverProcessAt: null }).where(eq(leagues.id, league.id));
        continue;
      }
      const window = waiverWindowAfter(order, now);
      await tx
        .update(leagues)
        .set({ waiverProcessAt: window.processAt, waiverMode: window.mode, waiverAfterRound: order })
        .where(eq(leagues.id, league.id));
    }
  });
  return {
    message: `Rodada ${order} fechada: ${finalized.length} confrontos finalizados, ${eliminated.length} clubes eliminados`,
    closed: true,
    details: { finalizedMatchups: finalized, eliminatedClubs: eliminated },
  };
}

async function eliminationsAfter(ctx: JobContext, order: number): Promise<number[]> {
  if (order === 8) return leagueStageEliminated(await ctx.provider.getLeagueStageRanks());
  const round = competitionRounds.find((r) => r.order === order);
  if (!round || (round.leg !== 2 && round.stage !== "FINAL")) return [];
  const legOrders = round.stage === "FINAL" ? [order] : [order - 1, order];
  const legs = await ctx.db.select().from(matches).where(inArray(matches.roundOrder, legOrders));
  return knockoutLosers(legs.filter((m) => m.status === "FINISHED")).losers;
}

/** Reprocessa uma rodada (botão do comissário): busca de novo na fonte e recalcula, sem fechar. */
export async function reprocessRound(ctx: JobContext, order: number): Promise<JobResult> {
  const finished = await ctx.db
    .select({ id: matches.id })
    .from(matches)
    .where(and(eq(matches.roundOrder, order), eq(matches.status, "FINISHED")));
  const [round] = await ctx.db.select().from(rounds).where(eq(rounds.order, order));
  const stats = await syncMatchStats(ctx, { matchIds: finished.map((m) => m.id), fresh: true, final: round?.closedAt != null });
  await ensureLineupSnapshots(ctx.db, ctx.now, order);
  await updateMatchupScores(ctx.db, order);
  return { message: `Rodada ${order} reprocessada: ${stats.message}`, details: stats.details, status: stats.status };
}

// ---------- Waivers ----------

export async function processWaivers(ctx: JobContext): Promise<JobResult> {
  const { db, now } = ctx;
  const due = await db.select().from(leagues).where(and(eq(leagues.status, "ACTIVE"), lte(leagues.waiverProcessAt, now)));
  const allRounds = await db.select().from(rounds);
  const round = currentRound(allRounds);
  if (round && isRoundLocked(round, now)) return { message: "Rodada travada: waivers aguardam o fechamento" };
  let succeeded = 0;
  for (const league of due) {
    await db.transaction(async (tx) => {
      const claims = await tx
        .select()
        .from(waiverClaims)
        .where(and(eq(waiverClaims.leagueId, league.id), eq(waiverClaims.status, "PENDING")));
      const slots = await tx.select().from(rosterSlots).where(eq(rosterSlots.leagueId, league.id));
      const involved = [...new Set([...slots.map((s) => s.playerId), ...claims.map((c) => c.addPlayerId)])];
      const playerRows = involved.length
        ? await tx
            .select({ id: players.id, position: players.position, clubId: players.clubId, active: players.active, eliminated: clubs.eliminatedAfterRound })
            .from(players)
            .innerJoin(clubs, eq(clubs.id, players.clubId))
            .where(inArray(players.id, involved))
        : [];
      const rosters = new Map<number, number[]>();
      for (const s of slots) rosters.set(s.teamId, [...(rosters.get(s.teamId) ?? []), s.playerId]);
      const result = resolveWaivers({
        order: waiverOrder(await leagueStandings(tx, league.id)),
        mode: league.waiverMode ?? "ROLLING",
        claims: claims.map((c) => ({ id: c.id, teamId: c.teamId, addPlayerId: c.addPlayerId, dropPlayerId: c.dropPlayerId, preference: c.preference })),
        rosters,
        players: new Map(
          playerRows.map((p) => [p.id, { position: p.position, clubId: p.clubId, active: p.active, clubEliminated: p.eliminated !== null }]),
        ),
        clubCap: game.roster.clubCap(round?.order ?? 1),
      });
      for (const move of result.moves) {
        await tx
          .update(rosterSlots)
          .set({ playerId: move.addPlayerId, acquiredVia: "WAIVER", acquiredAt: now })
          .where(and(eq(rosterSlots.teamId, move.teamId), eq(rosterSlots.playerId, move.dropPlayerId)));
      }
      for (const o of result.outcomes) {
        await tx
          .update(waiverClaims)
          .set({ status: o.status, failReason: o.reason, processedAt: now })
          .where(eq(waiverClaims.id, o.claimId));
      }
      await tx.update(leagues).set({ waiverProcessAt: null, waiverMode: null }).where(eq(leagues.id, league.id));
      succeeded += result.moves.length;
    });
  }
  return { message: `${due.length} liga(s) processada(s), ${succeeded} pedido(s) atendido(s)` };
}

// ---------- Orquestração (cron) ----------

const HOUR = 3_600_000;

/**
 * Ciclo agendado (a cada ~15–30 min):
 * calendário → elencos → estatísticas pós-jogo (parciais) → escalações travadas → placares →
 * fechamento da rodada (reprocessa, finaliza, elimina, abre waivers) → processamento de waivers.
 */
const jobQueue = ((globalThis as { __uclJobQueue?: { chain: Promise<unknown> } }).__uclJobQueue ??= { chain: Promise.resolve() });

/** Uma sincronização por vez no processo: um segundo clique espera a primeira terminar. */
export function runScheduledJobs(ctx: JobContext, options: { forceCalendar?: boolean } = {}) {
  const run = jobQueue.chain.then(() => runScheduledJobsNow(ctx, options));
  jobQueue.chain = run.catch(() => {});
  return run;
}

async function runScheduledJobsNow(ctx: JobContext, options: { forceCalendar?: boolean }) {
  const { db, now } = ctx;
  const results: Record<string, { ok: boolean; message: string }> = {};
  const allRounds = await db.select().from(rounds);
  const lastCalendar = await lastSuccess(db, "calendar");
  const awaitingResult = await db
    .select({ id: matches.id })
    .from(matches)
    .where(and(lte(matches.kickoff, now), inArray(matches.status, ["SCHEDULED", "LIVE"])))
    .limit(1);
  if (
    options.forceCalendar ||
    allRounds.length === 0 ||
    awaitingResult.length > 0 ||
    !lastCalendar ||
    now.getTime() - lastCalendar.getTime() > game.sync.calendarEveryHours * HOUR
  ) {
    results.calendar = await withSyncLog(ctx, "calendar", () => syncCalendar(ctx));
  }
  const lastSquads = await lastSuccess(db, "squads");
  if (!lastSquads || now.getTime() - lastSquads.getTime() > game.sync.squadsEveryHours * HOUR) {
    results.squads = await withSyncLog(ctx, "squads", () => syncSquads(ctx));
  }
  results.stats = await withSyncLog(ctx, "match-stats", () => syncMatchStats(ctx));
  await ensureLineupSnapshots(db, now);

  const round = currentRound(await db.select().from(rounds));
  if (round) {
    await updateMatchupScores(db, round.order);
    results.close = await withSyncLog(ctx, `close-round-${round.order}`, async () => {
      const r = await closeRound(ctx, round.order);
      // Rodada ainda não pronta para fechar fica registrada como PARTIAL, com o motivo.
      return { ...r, status: r.closed ? "SUCCESS" : "PARTIAL" };
    });
  }
  results.waivers = await withSyncLog(ctx, "waivers", () => processWaivers(ctx));
  return results;
}
