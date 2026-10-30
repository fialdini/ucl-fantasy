import { and, asc, eq, inArray } from "drizzle-orm";
import { managerScoring } from "@config/scoring";
import type { Db, DbOrTx } from "@/db/client";
import { clubs, coaches, fantasyTeams, managerSnapshots, matches, playerMatchStats, rounds } from "@/db/schema";
import { lineupLockState } from "@/domain/lock";
import { managerPoints } from "@/domain/manager";
import { GameError } from "./errors";
import { teamOf } from "./leagues";

/** PENDING = jogo encerrado sem estatística oficial; UPCOMING = jogo ainda não terminou. */
export type ManagerStatus = "SCORED" | "PENDING" | "UPCOMING" | "NO_MATCH";

export interface ManagerRoundScore {
  coachId: number;
  name: string;
  clubId: number;
  status: ManagerStatus;
  points: number;
  breakdown: Array<{ label: string; points: number }>;
}

/** Pontos de um técnico (pelo clube) numa rodada. Só partida encerrada com estatística oficial conta. */
export async function managerRoundScore(db: DbOrTx, coachId: number, roundOrder: number): Promise<ManagerRoundScore | null> {
  const [coach] = await db.select().from(coaches).where(eq(coaches.id, coachId));
  if (!coach) return null;
  const roundMatches = await db.select().from(matches).where(eq(matches.roundOrder, roundOrder));
  const match = roundMatches.find((m) => m.homeClubId === coach.clubId || m.awayClubId === coach.clubId);
  const base = { coachId, name: coach.name, clubId: coach.clubId, points: 0, breakdown: [] };
  if (!match || match.status === "CANCELLED") return { ...base, status: "NO_MATCH" };
  if (match.status !== "FINISHED") return { ...base, status: "UPCOMING" };
  if (match.statsStatus === "NONE" || match.homeGoals === null || match.awayGoals === null) return { ...base, status: "PENDING" };
  const home = match.homeClubId === coach.clubId;
  const stats = await db
    .select({ points: playerMatchStats.points, minutes: playerMatchStats.minutes })
    .from(playerMatchStats)
    .where(and(eq(playerMatchStats.matchId, match.id), eq(playerMatchStats.clubId, coach.clubId)));
  const scored = managerPoints({
    goalsFor: home ? match.homeGoals : match.awayGoals,
    goalsAgainst: home ? match.awayGoals : match.homeGoals,
    playerPoints: stats.filter((s) => s.minutes >= managerScoring.minMinutes).map((s) => s.points),
  });
  return { ...base, status: "SCORED", ...scored };
}

/** Técnico que vale na rodada: o congelado, ou o atual se ela ainda não travou. */
export async function managerFor(db: DbOrTx, teamId: number, roundOrder: number, locked: boolean): Promise<number | null> {
  if (locked) {
    const [snap] = await db
      .select({ coachId: managerSnapshots.coachId })
      .from(managerSnapshots)
      .where(and(eq(managerSnapshots.teamId, teamId), eq(managerSnapshots.roundOrder, roundOrder)));
    return snap?.coachId ?? null;
  }
  const [team] = await db.select({ managerId: fantasyTeams.managerId }).from(fantasyTeams).where(eq(fantasyTeams.id, teamId));
  return team?.managerId ?? null;
}

/** Técnicos da liga com o dono (quando contratado), para a lista do mercado. */
export async function leagueCoaches(db: Db, leagueId: number) {
  const rows = await db
    .select({
      id: coaches.id,
      name: coaches.name,
      photoUrl: coaches.photoUrl,
      club: clubs.shortName,
      clubName: clubs.name,
      clubId: clubs.id,
      eliminated: clubs.eliminatedAfterRound,
    })
    .from(coaches)
    .innerJoin(clubs, eq(clubs.id, coaches.clubId))
    .where(eq(coaches.active, true))
    .orderBy(asc(clubs.name));
  const owners = await db
    .select({ managerId: fantasyTeams.managerId, teamId: fantasyTeams.id, teamName: fantasyTeams.name })
    .from(fantasyTeams)
    .where(eq(fantasyTeams.leagueId, leagueId));
  const ownerOf = new Map(owners.filter((o) => o.managerId !== null).map((o) => [o.managerId!, o]));
  return rows.map((c) => ({ ...c, owner: ownerOf.get(c.id) ?? null }));
}

/** Contrata (ou, com null, dispensa) o técnico do time. Troca livre enquanto a rodada não trava. */
export async function setManager(db: Db, leagueId: number, userId: number, coachId: number | null, now: Date) {
  const state = lineupLockState(await db.select().from(rounds), now);
  if (state.locked) throw new GameError(state.reason);
  const team = await teamOf(db, leagueId, userId);
  if (!team) throw new GameError("Você não tem time nesta liga");
  if (coachId !== null) {
    const [row] = await db
      .select({ active: coaches.active, eliminated: clubs.eliminatedAfterRound })
      .from(coaches)
      .innerJoin(clubs, eq(clubs.id, coaches.clubId))
      .where(eq(coaches.id, coachId));
    if (!row || !row.active) throw new GameError("Técnico indisponível");
    if (row.eliminated !== null) throw new GameError("O clube desse técnico foi eliminado");
    const [owner] = await db
      .select({ id: fantasyTeams.id })
      .from(fantasyTeams)
      .where(and(eq(fantasyTeams.leagueId, leagueId), eq(fantasyTeams.managerId, coachId)));
    if (owner && owner.id !== team.id) throw new GameError("Esse técnico já pertence a outro time");
  }
  await db.update(fantasyTeams).set({ managerId: coachId }).where(eq(fantasyTeams.id, team.id));
}

export async function coachesByIds(db: DbOrTx, ids: readonly number[]) {
  return ids.length ? db.select().from(coaches).where(inArray(coaches.id, [...ids])) : [];
}

/** Tudo da página do técnico: pontos por rodada (pelo clube dele), próximos jogos e dono na liga. */
export async function managerDetail(db: Db, leagueId: number, coachId: number) {
  const [row] = await db
    .select({ coach: coaches, club: clubs })
    .from(coaches)
    .innerJoin(clubs, eq(clubs.id, coaches.clubId))
    .where(eq(coaches.id, coachId));
  if (!row) return null;
  const { coach, club } = row;
  const [allRounds, allMatches, allClubs, owner] = await Promise.all([
    db.select().from(rounds).orderBy(asc(rounds.order)),
    db.select().from(matches).orderBy(asc(matches.kickoff)),
    db.select().from(clubs),
    db
      .select({ teamId: fantasyTeams.id, teamName: fantasyTeams.name, userId: fantasyTeams.userId })
      .from(fantasyTeams)
      .where(and(eq(fantasyTeams.leagueId, leagueId), eq(fantasyTeams.managerId, coachId))),
  ]);
  const clubById = new Map(allClubs.map((c) => [c.id, c]));
  const mine = allMatches.filter((m) => m.homeClubId === club.id || m.awayClubId === club.id);
  const season = [];
  for (const round of allRounds) {
    const match = mine.find((m) => m.roundOrder === round.order);
    if (!match) continue;
    const home = match.homeClubId === club.id;
    const opponent = clubById.get(home ? match.awayClubId : match.homeClubId) ?? null;
    const score = match.status === "FINISHED" ? await managerRoundScore(db, coachId, round.order) : null;
    season.push({ round, match, home, opponent, score });
  }
  const played = season.filter((s) => s.score?.status === "SCORED");
  const total = played.reduce((sum, s) => sum + s.score!.points, 0);
  return {
    coach,
    club,
    owner: owner[0] ?? null,
    season,
    upcoming: season.filter((s) => s.match.status !== "FINISHED"),
    totals: { points: Math.round(total * 100) / 100, games: played.length, avg: played.length ? Math.round((total / played.length) * 10) / 10 : 0 },
  };
}
