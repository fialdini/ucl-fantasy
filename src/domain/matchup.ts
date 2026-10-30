import { roundPoints } from "./scoring";
import type { MatchStatus } from "./types";

export type StatsStatus = "NONE" | "PARTIAL" | "FINAL";

export type PlayerRoundStatus =
  | "SCORED" // estatística disponível
  | "DID_NOT_PLAY" // partida com estatística, mas o jogador não entrou
  | "AWAITING_DATA" // partida encerrada, estatística oficial ainda não chegou
  | "NOT_STARTED"
  | "LIVE"
  | "NO_MATCH"; // clube sem jogo na rodada (eliminado) ou partida cancelada

export interface StarterInput {
  playerId: number;
  /** Partida do clube do jogador na rodada; null se o clube não joga. */
  match: { status: MatchStatus; statsStatus: StatsStatus } | null;
  /** Pontos da estatística do jogador nessa partida; null se não há linha de estatística. */
  points: number | null;
}

export function playerRoundStatus(s: StarterInput): PlayerRoundStatus {
  if (!s.match || s.match.status === "CANCELLED") return "NO_MATCH";
  if (s.match.status === "SCHEDULED" || s.match.status === "POSTPONED") return "NOT_STARTED";
  if (s.match.status === "LIVE") return "LIVE";
  if (s.match.statsStatus === "NONE") return "AWAITING_DATA";
  return s.points === null ? "DID_NOT_PLAY" : "SCORED";
}

/** Soma só o que é oficial. Se algum titular aguarda dados, o placar é marcado como incompleto. */
export function teamScore(starters: readonly StarterInput[]): {
  points: number;
  awaitingData: boolean;
  lines: Array<{ playerId: number; status: PlayerRoundStatus; points: number }>;
} {
  const lines = starters.map((s) => {
    const status = playerRoundStatus(s);
    return { playerId: s.playerId, status, points: status === "SCORED" ? (s.points ?? 0) : 0 };
  });
  return {
    points: roundPoints(lines.reduce((sum, l) => sum + l.points, 0)),
    awaitingData: lines.some((l) => l.status === "AWAITING_DATA"),
    lines,
  };
}

/**
 * Vencedor do confronto. Temporada regular aceita empate (null).
 * Playoff não empata: avança a melhor campanha (menor seed).
 */
export function matchupWinner(
  m: { kind: "REGULAR" | "SEMI" | "FINAL"; homeTeamId: number; awayTeamId: number },
  homePoints: number,
  awayPoints: number,
  seeds: ReadonlyMap<number, number> = new Map(),
): number | null {
  if (homePoints > awayPoints) return m.homeTeamId;
  if (awayPoints > homePoints) return m.awayTeamId;
  if (m.kind === "REGULAR") return null;
  const homeSeed = seeds.get(m.homeTeamId) ?? Number.MAX_SAFE_INTEGER;
  const awaySeed = seeds.get(m.awayTeamId) ?? Number.MAX_SAFE_INTEGER;
  return homeSeed <= awaySeed ? m.homeTeamId : m.awayTeamId;
}

export interface StandingRow {
  teamId: number;
  wins: number;
  ties: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
}

/** Classificação: aproveitamento (V + 0,5·E), depois pontos marcados, depois id (estável). */
export function computeStandings(
  teamIds: readonly number[],
  finalRegularMatchups: ReadonlyArray<{
    homeTeamId: number;
    awayTeamId: number;
    homePoints: number;
    awayPoints: number;
    winnerTeamId: number | null;
  }>,
): StandingRow[] {
  const rows = new Map<number, StandingRow>(
    teamIds.map((teamId) => [teamId, { teamId, wins: 0, ties: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }]),
  );
  for (const m of finalRegularMatchups) {
    const home = rows.get(m.homeTeamId);
    const away = rows.get(m.awayTeamId);
    if (!home || !away) continue;
    home.pointsFor = roundPoints(home.pointsFor + m.homePoints);
    home.pointsAgainst = roundPoints(home.pointsAgainst + m.awayPoints);
    away.pointsFor = roundPoints(away.pointsFor + m.awayPoints);
    away.pointsAgainst = roundPoints(away.pointsAgainst + m.homePoints);
    if (m.winnerTeamId === null) {
      home.ties++;
      away.ties++;
    } else if (m.winnerTeamId === m.homeTeamId) {
      home.wins++;
      away.losses++;
    } else {
      away.wins++;
      home.losses++;
    }
  }
  const pct = (r: StandingRow) => {
    const games = r.wins + r.ties + r.losses;
    return games === 0 ? 0 : (r.wins + r.ties / 2) / games;
  };
  return [...rows.values()].sort(
    (a, b) => pct(b) - pct(a) || b.pointsFor - a.pointsFor || a.teamId - b.teamId,
  );
}

/**
 * Tabela da temporada regular (método do círculo). Com número ímpar de times, um folga por rodada.
 * Repete o turno quando há mais rodadas que adversários, invertendo o mando.
 */
export function roundRobinSchedule(
  teamIds: readonly number[],
  roundOrders: readonly number[],
): Array<{ round: number; homeTeamId: number; awayTeamId: number }> {
  const slots: Array<number | null> = [...teamIds];
  if (slots.length % 2 === 1) slots.push(null);
  const n = slots.length;
  const schedule: Array<{ round: number; homeTeamId: number; awayTeamId: number }> = [];
  roundOrders.forEach((round, index) => {
    const cycleRound = index % (n - 1);
    const flip = Math.floor(index / (n - 1)) % 2 === 1;
    // rotação: fixa o primeiro, gira os demais
    const rotated = [slots[0]!, ...rotate(slots.slice(1), cycleRound)];
    for (let i = 0; i < n / 2; i++) {
      const a = rotated[i];
      const b = rotated[n - 1 - i];
      if (a === null || b === null || a === undefined || b === undefined) continue;
      const homeFirst = (i + cycleRound) % 2 === 0 !== flip;
      schedule.push({ round, homeTeamId: homeFirst ? a : b, awayTeamId: homeFirst ? b : a });
    }
  });
  return schedule;
}

function rotate<T>(items: readonly T[], k: number): T[] {
  if (items.length === 0) return [];
  const s = k % items.length;
  return [...items.slice(items.length - s), ...items.slice(0, items.length - s)];
}

/** Semifinais dos playoffs: 1º × 4º e 2º × 3º (mando da melhor campanha). */
export function playoffSemis(standings: readonly StandingRow[]): Array<{ homeTeamId: number; awayTeamId: number }> {
  const [s1, s2, s3, s4] = standings;
  if (!s1 || !s2 || !s3 || !s4) return [];
  return [
    { homeTeamId: s1.teamId, awayTeamId: s4.teamId },
    { homeTeamId: s2.teamId, awayTeamId: s3.teamId },
  ];
}

/** Ordem de waiver: inversa à classificação (pior campanha escolhe primeiro). */
export function waiverOrder(standings: readonly StandingRow[]): number[] {
  return [...standings].reverse().map((r) => r.teamId);
}
