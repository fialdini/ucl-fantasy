import { and, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { lineupSnapshots, matches, playerMatchStats, players, rosterSlots, rounds } from "@/db/schema";
import { teamScore, type PlayerRoundStatus } from "@/domain/matchup";
import type { Position, Slot } from "@/domain/types";

export interface TeamRoundLine {
  playerId: number;
  name: string;
  position: Position;
  clubId: number;
  slot: Slot;
  status: PlayerRoundStatus;
  points: number;
  final: boolean;
  breakdown: Array<{ label: string; points: number }>;
}

export interface TeamRoundScore {
  points: number;
  awaitingData: boolean;
  /** true = escalação congelada (rodada travada); false = projeção com o elenco atual. */
  locked: boolean;
  lines: TeamRoundLine[];
}

/** Escalação que vale para a rodada: a congelada, ou o elenco atual se a rodada ainda não travou. */
export async function lineupFor(db: DbOrTx, teamId: number, roundOrder: number) {
  const snapshot = await db
    .select({ playerId: lineupSnapshots.playerId, slot: lineupSnapshots.slot })
    .from(lineupSnapshots)
    .where(and(eq(lineupSnapshots.teamId, teamId), eq(lineupSnapshots.roundOrder, roundOrder)));
  if (snapshot.length > 0) return { locked: true, slots: snapshot };
  const current = await db
    .select({ playerId: rosterSlots.playerId, slot: rosterSlots.slot })
    .from(rosterSlots)
    .where(eq(rosterSlots.teamId, teamId));
  return { locked: false, slots: current };
}

export async function teamRoundScore(db: DbOrTx, teamId: number, roundOrder: number): Promise<TeamRoundScore> {
  const { locked, slots } = await lineupFor(db, teamId, roundOrder);
  if (slots.length === 0) return { points: 0, awaitingData: false, locked, lines: [] };
  const ids = slots.map((s) => s.playerId);
  const [playerRows, roundMatches, statRows] = await Promise.all([
    db.select().from(players).where(inArray(players.id, ids)),
    db.select().from(matches).where(eq(matches.roundOrder, roundOrder)),
    db
      .select()
      .from(playerMatchStats)
      .where(and(eq(playerMatchStats.roundOrder, roundOrder), inArray(playerMatchStats.playerId, ids))),
  ]);
  const playerById = new Map(playerRows.map((p) => [p.id, p]));
  const statsByPlayer = new Map(statRows.map((s) => [s.playerId, s]));
  const matchByClub = new Map<number, (typeof roundMatches)[number]>();
  for (const m of roundMatches) {
    matchByClub.set(m.homeClubId, m);
    matchByClub.set(m.awayClubId, m);
  }

  const inputs = slots.map((s) => {
    const stat = statsByPlayer.get(s.playerId);
    // Estatística vale para o clube em que o jogador estava na partida.
    const match = stat ? roundMatches.find((m) => m.id === stat.matchId) : matchByClub.get(playerById.get(s.playerId)?.clubId ?? -1);
    return {
      playerId: s.playerId,
      match: match ? { status: match.status, statsStatus: match.statsStatus } : null,
      points: stat?.points ?? null,
    };
  });
  const starters = inputs.filter((_, i) => slots[i]!.slot === "STARTER");
  const score = teamScore(starters);
  const benchScore = teamScore(inputs.filter((_, i) => slots[i]!.slot === "BENCH"));
  const lineByPlayer = new Map([...score.lines, ...benchScore.lines].map((l) => [l.playerId, l]));

  const lines: TeamRoundLine[] = slots.map((s) => {
    const p = playerById.get(s.playerId);
    const line = lineByPlayer.get(s.playerId)!;
    const stat = statsByPlayer.get(s.playerId);
    return {
      playerId: s.playerId,
      name: p?.name ?? `#${s.playerId}`,
      position: p?.position ?? "MID",
      clubId: p?.clubId ?? 0,
      slot: s.slot,
      status: line.status,
      points: line.points,
      final: stat?.final ?? false,
      breakdown: line.status === "SCORED" ? (stat?.breakdown ?? []) : [],
    };
  });
  return { points: score.points, awaitingData: score.awaitingData, locked, lines };
}

/** Pontos de um time somados nas rodadas de um confronto (playoffs somam 2 pernas). */
export async function teamSpanScore(db: DbOrTx, teamId: number, fromRound: number, toRound: number) {
  let points = 0;
  let awaitingData = false;
  let started = false;
  for (let order = fromRound; order <= toRound; order++) {
    const [round] = await db.select().from(rounds).where(eq(rounds.order, order));
    if (!round) continue;
    const s = await teamRoundScore(db, teamId, order);
    // Rodada que ainda não travou não conta (escalação pode mudar).
    if (!s.locked) continue;
    started = true;
    points += s.points;
    awaitingData ||= s.awaitingData;
  }
  return { points, awaitingData, started };
}
