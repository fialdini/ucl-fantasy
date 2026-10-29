import { game } from "@config/game";
import type { MatchStatus } from "./types";

export interface MatchTiming {
  id: number;
  status: MatchStatus;
  kickoff: Date;
}

/**
 * A rodada só fecha quando todas as partidas terminaram (ou foram canceladas) e passou o prazo
 * de correção da fonte após o último jogo. Partidas adiadas seguram o fechamento.
 */
export function roundCloseReadiness(
  matches: readonly MatchTiming[],
  now: Date,
  cfg: { closeDelayHours: number; matchDurationMinutes: number } = game.sync,
): { ready: boolean; reason: string | null; pendingMatchIds: number[] } {
  if (matches.length === 0) return { ready: false, reason: "Rodada sem partidas definidas", pendingMatchIds: [] };
  const pending = matches.filter((m) => m.status !== "FINISHED" && m.status !== "CANCELLED");
  if (pending.length > 0) {
    return {
      ready: false,
      reason: `${pending.length} partida(s) não encerrada(s)`,
      pendingMatchIds: pending.map((m) => m.id),
    };
  }
  const lastKickoff = Math.max(...matches.map((m) => m.kickoff.getTime()));
  const closeAt = lastKickoff + cfg.matchDurationMinutes * 60_000 + cfg.closeDelayHours * 3_600_000;
  if (now.getTime() < closeAt) {
    return {
      ready: false,
      reason: `Aguardando prazo de correção até ${new Date(closeAt).toISOString()}`,
      pendingMatchIds: [],
    };
  }
  return { ready: true, reason: null, pendingMatchIds: [] };
}

export interface KnockoutMatch {
  homeClubId: number;
  awayClubId: number;
  homeGoals: number | null;
  awayGoals: number | null;
  homePenalties: number | null;
  awayPenalties: number | null;
  kickoff: Date;
}

/**
 * Clubes eliminados num mata-mata. Agrega as pernas de cada confronto (gols incluem prorrogação);
 * em empate no agregado decide a disputa de pênaltis da última perna.
 * Retorna também os confrontos que não puderam ser decididos (dados incompletos).
 */
export function knockoutLosers(matches: readonly KnockoutMatch[]): { losers: number[]; undecided: string[] } {
  const ties = new Map<string, KnockoutMatch[]>();
  for (const m of matches) {
    const key = [m.homeClubId, m.awayClubId].sort((a, b) => a - b).join("-");
    ties.set(key, [...(ties.get(key) ?? []), m]);
  }
  const losers: number[] = [];
  const undecided: string[] = [];
  for (const [key, legs] of ties) {
    if (legs.some((l) => l.homeGoals === null || l.awayGoals === null)) {
      undecided.push(key);
      continue;
    }
    const [a, b] = key.split("-").map(Number) as [number, number];
    const goalsFor = (club: number) =>
      legs.reduce((sum, l) => sum + (l.homeClubId === club ? l.homeGoals! : l.awayGoals!), 0);
    const aggA = goalsFor(a);
    const aggB = goalsFor(b);
    if (aggA !== aggB) {
      losers.push(aggA < aggB ? a : b);
      continue;
    }
    const last = [...legs].sort((x, y) => y.kickoff.getTime() - x.kickoff.getTime())[0]!;
    if (last.homePenalties === null || last.awayPenalties === null || last.homePenalties === last.awayPenalties) {
      undecided.push(key);
      continue;
    }
    losers.push(last.homePenalties < last.awayPenalties ? last.homeClubId : last.awayClubId);
  }
  return { losers, undecided };
}

/** Fase de liga: 1º–8º vão às oitavas, 9º–24º ao playoff, 25º–36º estão eliminados. */
export function leagueStageEliminated(ranks: ReadonlyMap<number, number>): number[] {
  return [...ranks].filter(([, rank]) => rank > 24).map(([clubId]) => clubId);
}

/** Janela de waiver aberta pelo fechamento da rodada. Após a fase de liga e o playoff vira repescagem. */
export function waiverWindowAfter(
  roundOrder: number,
  closedAt: Date,
): { processAt: Date; mode: "ROLLING" | "REPECHAGE" } {
  const repechage = (game.waivers.repechageAfterRounds as readonly number[]).includes(roundOrder);
  return {
    processAt: new Date(closedAt.getTime() + game.waivers.windowHours * 3_600_000),
    mode: repechage ? "REPECHAGE" : "ROLLING",
  };
}

export interface MatchupSpan {
  id: number;
  fromRound: number;
  toRound: number;
}

/** Confrontos afetados pelo fechamento: os que terminam nesta rodada ficam finais. */
export function matchupsClosedBy<T extends MatchupSpan>(matchups: readonly T[], roundOrder: number): T[] {
  return matchups.filter((m) => m.toRound === roundOrder);
}
