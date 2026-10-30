import { and, asc, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  clubs,
  fantasyTeams,
  leagueMembers,
  leagues,
  matches,
  matchups,
  playerMatchStats,
  players,
  rosterSlots,
  rounds,
  syncLogs,
  users,
  waiverClaims,
} from "@/db/schema";
import { currentRound, isRoundLocked } from "@/domain/lock";
import type { SubPosition } from "@/domain/subpositions";
import type { Position } from "@/domain/types";

export async function myLeagues(db: Db, userId: number) {
  return db
    .select({ id: leagues.id, name: leagues.name, status: leagues.status, teamName: fantasyTeams.name })
    .from(leagueMembers)
    .innerJoin(leagues, eq(leagues.id, leagueMembers.leagueId))
    .leftJoin(fantasyTeams, and(eq(fantasyTeams.leagueId, leagues.id), eq(fantasyTeams.userId, userId)))
    .where(eq(leagueMembers.userId, userId))
    .orderBy(desc(leagues.createdAt));
}

export async function leagueTeams(db: Db, leagueId: number) {
  return db
    .select({ id: fantasyTeams.id, name: fantasyTeams.name, userId: fantasyTeams.userId, owner: users.name })
    .from(fantasyTeams)
    .innerJoin(users, eq(users.id, fantasyTeams.userId))
    .where(eq(fantasyTeams.leagueId, leagueId))
    .orderBy(asc(fantasyTeams.id));
}

export async function roundsState(db: Db, now: Date) {
  const all = await db.select().from(rounds).orderBy(asc(rounds.order));
  const current = currentRound(all);
  return { all, current, locked: current ? isRoundLocked(current, now) : false };
}

const seasonTotals = (db: Db) =>
  db
    .select({
      playerId: playerMatchStats.playerId,
      total: sql<number>`round(sum(${playerMatchStats.points})::numeric, 2)`.as("total"),
      games: sql<number>`count(*) filter (where ${playerMatchStats.minutes} > 0)`.as("games"),
    })
    .from(playerMatchStats)
    .groupBy(playerMatchStats.playerId)
    .as("totals");

export async function rosterView(db: Db, teamId: number) {
  const totals = seasonTotals(db);
  return db
    .select({
      playerId: players.id,
      name: players.name,
      position: players.position,
      subPosition: players.subPosition,
      photoUrl: players.photoUrl,
      active: players.active,
      injured: players.injured,
      injuryReturn: players.injuryReturn,
      injurySource: players.injurySource,
      injuryNote: players.injuryNote,
      club: clubs.shortName,
      clubId: clubs.id,
      eliminated: clubs.eliminatedAfterRound,
      slot: rosterSlots.slot,
      total: sql<number>`coalesce(${totals.total}, 0)`.mapWith(Number),
      games: sql<number>`coalesce(${totals.games}, 0)`.mapWith(Number),
    })
    .from(rosterSlots)
    .innerJoin(players, eq(players.id, rosterSlots.playerId))
    .innerJoin(clubs, eq(clubs.id, players.clubId))
    .leftJoin(totals, eq(totals.playerId, players.id))
    .where(eq(rosterSlots.teamId, teamId));
}

export interface PlayerFilter {
  leagueId: number;
  position?: Position;
  subPosition?: SubPosition;
  clubId?: number;
  q?: string;
  onlyFree?: boolean;
  /** Só jogadores que já têm time na liga. */
  onlyOwned?: boolean;
  sort?: "total" | "avg" | "name";
  limit?: number;
}

/** Pesquisa de jogadores com pontos totais, média e dono na liga. */
export async function searchPlayers(db: Db, f: PlayerFilter) {
  const totals = seasonTotals(db);
  const owner = db
    .select({ playerId: rosterSlots.playerId, teamName: fantasyTeams.name, teamId: fantasyTeams.id })
    .from(rosterSlots)
    .innerJoin(fantasyTeams, eq(fantasyTeams.id, rosterSlots.teamId))
    .where(eq(rosterSlots.leagueId, f.leagueId))
    .as("owner");
  const conditions: SQL[] = [eq(players.active, true)];
  if (f.position) conditions.push(eq(players.position, f.position));
  if (f.subPosition) conditions.push(eq(players.subPosition, f.subPosition));
  if (f.onlyOwned) conditions.push(sql`${owner.playerId} is not null`);
  if (f.clubId) conditions.push(eq(players.clubId, f.clubId));
  if (f.q) conditions.push(ilike(players.name, `%${f.q}%`));
  if (f.onlyFree) conditions.push(sql`${owner.playerId} is null`);
  const avg = sql<number>`coalesce(${totals.total}::float / nullif(${totals.games}, 0), 0)`;
  return db
    .select({
      playerId: players.id,
      name: players.name,
      position: players.position,
      subPosition: players.subPosition,
      photoUrl: players.photoUrl,
      injured: players.injured,
      injuryReturn: players.injuryReturn,
      injurySource: players.injurySource,
      injuryNote: players.injuryNote,
      club: clubs.shortName,
      clubId: clubs.id,
      eliminated: clubs.eliminatedAfterRound,
      total: sql<number>`coalesce(${totals.total}, 0)`.mapWith(Number),
      games: sql<number>`coalesce(${totals.games}, 0)`.mapWith(Number),
      avg: avg.mapWith(Number),
      ownerTeam: owner.teamName,
      ownerTeamId: owner.teamId,
    })
    .from(players)
    .innerJoin(clubs, eq(clubs.id, players.clubId))
    .leftJoin(totals, eq(totals.playerId, players.id))
    .leftJoin(owner, eq(owner.playerId, players.id))
    .where(and(...conditions))
    .orderBy(...(f.sort === "name" ? [asc(players.name)] : f.sort === "avg" ? [desc(avg), asc(players.name)] : [desc(sql`coalesce(${totals.total}, 0)`), asc(players.name)]))
    .limit(f.limit ?? 100);
}

/** Partidas agrupadas por rodada (para byes). */
export async function matchesByRound(db: Db) {
  const map = new Map<number, Array<typeof matches.$inferSelect>>();
  for (const m of await db.select().from(matches)) map.set(m.roundOrder, [...(map.get(m.roundOrder) ?? []), m]);
  return map;
}

export async function allClubs(db: Db) {
  return db.select().from(clubs).orderBy(asc(clubs.name));
}

export async function roundMatchups(db: Db, leagueId: number, roundOrder: number) {
  return db
    .select()
    .from(matchups)
    .where(
      and(
        eq(matchups.leagueId, leagueId),
        sql`${matchups.fromRound} <= ${roundOrder}`,
        sql`${matchups.toRound} >= ${roundOrder}`,
      ),
    )
    .orderBy(asc(matchups.id));
}

export async function roundMatches(db: Db, roundOrder: number) {
  return db.select().from(matches).where(eq(matches.roundOrder, roundOrder)).orderBy(asc(matches.kickoff));
}

export async function clubNames(db: Db) {
  return new Map((await db.select().from(clubs)).map((c) => [c.id, c]));
}

export async function teamClaims(db: Db, teamId: number) {
  const add = sql<string>`(select name from ${players} where ${players.id} = ${waiverClaims.addPlayerId})`;
  const drop = sql<string>`(select name from ${players} where ${players.id} = ${waiverClaims.dropPlayerId})`;
  return db
    .select({
      id: waiverClaims.id,
      status: waiverClaims.status,
      failReason: waiverClaims.failReason,
      preference: waiverClaims.preference,
      addName: add,
      dropName: drop,
      createdAt: waiverClaims.createdAt,
    })
    .from(waiverClaims)
    .where(eq(waiverClaims.teamId, teamId))
    .orderBy(desc(waiverClaims.id))
    .limit(30);
}

export async function recentSyncLogs(db: Db, limit = 30) {
  return db.select().from(syncLogs).orderBy(desc(syncLogs.id)).limit(limit);
}

export async function pendingStatsMatches(db: Db) {
  return db
    .select()
    .from(matches)
    .where(and(eq(matches.status, "FINISHED"), inArray(matches.statsStatus, ["NONE"])))
    .orderBy(asc(matches.kickoff));
}
