import { and, eq } from "drizzle-orm";
import { game } from "@config/game";
import type { DbOrTx } from "@/db/client";
import { fantasyTeams, matchups } from "@/db/schema";
import { computeStandings, playoffSemis, roundRobinSchedule, type StandingRow } from "@/domain/matchup";

/** Cria os confrontos da temporada regular: da rodada de início até a última da temporada regular. */
export async function createRegularSchedule(db: DbOrTx, leagueId: number, startRound: number) {
  const teams = await db.select({ id: fantasyTeams.id }).from(fantasyTeams).where(eq(fantasyTeams.leagueId, leagueId));
  const roundOrders: number[] = [];
  for (let r = startRound; r <= game.season.regularSeasonLastRound; r++) roundOrders.push(r);
  const schedule = roundRobinSchedule(
    teams.map((t) => t.id),
    roundOrders,
  );
  if (schedule.length === 0) return;
  await db.insert(matchups).values(
    schedule.map((m) => ({
      leagueId,
      kind: "REGULAR" as const,
      fromRound: m.round,
      toRound: m.round,
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
    })),
  );
}

export async function leagueStandings(db: DbOrTx, leagueId: number): Promise<StandingRow[]> {
  const teams = await db.select({ id: fantasyTeams.id }).from(fantasyTeams).where(eq(fantasyTeams.leagueId, leagueId));
  const finals = await db
    .select()
    .from(matchups)
    .where(and(eq(matchups.leagueId, leagueId), eq(matchups.kind, "REGULAR"), eq(matchups.status, "FINAL")));
  return computeStandings(
    teams.map((t) => t.id),
    finals.map((m) => ({
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
      homePoints: m.homePoints ?? 0,
      awayPoints: m.awayPoints ?? 0,
      winnerTeamId: m.winnerTeamId,
    })),
  );
}

/**
 * Avança os playoffs após o fechamento de `closedRound`:
 * fim da temporada regular → semifinais (top 4); fim das semis → final.
 * Mandante = melhor campanha, que também vence em caso de empate.
 */
export async function advancePlayoffs(db: DbOrTx, leagueId: number, closedRound: number): Promise<"COMPLETE" | null> {
  const [semi, final] = game.season.playoffs;
  if (closedRound === game.season.regularSeasonLastRound) {
    const standings = await leagueStandings(db, leagueId);
    const pairs = playoffSemis(standings.slice(0, game.season.playoffTeams));
    if (pairs.length > 0) {
      await db.insert(matchups).values(
        pairs.map((p) => ({ leagueId, kind: "SEMI" as const, fromRound: semi.fromRound, toRound: semi.toRound, ...p })),
      );
    }
    return pairs.length > 0 ? null : "COMPLETE";
  }
  if (closedRound === semi.toRound) {
    const semis = await db
      .select()
      .from(matchups)
      .where(and(eq(matchups.leagueId, leagueId), eq(matchups.kind, "SEMI")))
      .orderBy(matchups.id);
    const winners = semis.map((m) => m.winnerTeamId).filter((id): id is number => id !== null);
    if (winners.length === 2) {
      // O vencedor da semi 1 (com o 1º colocado) é o mandante se for o 1º; ordena pela classificação.
      const standings = await leagueStandings(db, leagueId);
      const rank = new Map(standings.map((r, i) => [r.teamId, i]));
      const [home, away] = [...winners].sort((a, b) => (rank.get(a) ?? 99) - (rank.get(b) ?? 99));
      await db.insert(matchups).values({
        leagueId,
        kind: "FINAL",
        fromRound: final.fromRound,
        toRound: final.toRound,
        homeTeamId: home!,
        awayTeamId: away!,
      });
    }
    return null;
  }
  if (closedRound === final.toRound) return "COMPLETE";
  return null;
}

