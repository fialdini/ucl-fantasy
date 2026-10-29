import { scoring as defaultScoring, type ScoringConfig } from "@config/scoring";
import type { MatchDetail, Position, RawPlayerStats } from "./types";

export interface ScoreLine {
  label: string;
  points: number;
}

export interface PlayerScore {
  points: number;
  cleanSheet: boolean;
  breakdown: ScoreLine[];
}

export function computePoints(position: Position, s: RawPlayerStats, cfg: ScoringConfig = defaultScoring): PlayerScore {
  const breakdown: ScoreLine[] = [];
  const add = (label: string, points: number) => {
    if (points !== 0) breakdown.push({ label, points });
  };

  if (s.minutes >= cfg.appearance.fullMinutes) add(`Jogou ${s.minutes} min`, cfg.appearance.full);
  else if (s.minutes >= cfg.appearance.minMinutes) add(`Jogou ${s.minutes} min`, cfg.appearance.partial);

  add(`${s.goals} gol(s)`, s.goals * cfg.goal[position]);
  add(`${s.assists} assistência(s)`, s.assists * cfg.assist);

  const cleanSheet = s.minutes >= cfg.cleanSheet.minMinutes && s.goalsConceded === 0;
  if (cleanSheet) add("Clean sheet", cfg.cleanSheet.points[position]);

  if (position === "GK") {
    add(`${s.saves} defesa(s)`, Math.floor(s.saves / cfg.saves.per) * cfg.saves.points);
    add(`${s.penaltiesSaved} pênalti(s) defendido(s)`, s.penaltiesSaved * cfg.penaltySaved);
  }
  if (cfg.goalsConceded.positions.includes(position)) {
    add(
      `${s.goalsConceded} gol(s) sofrido(s)`,
      Math.floor(s.goalsConceded / cfg.goalsConceded.per) * cfg.goalsConceded.points,
    );
  }

  add(`${s.yellowCards} amarelo(s)`, s.yellowCards * cfg.yellowCard);
  add(`${s.redCards} vermelho(s)`, s.redCards * cfg.redCard);
  add(`${s.ownGoals} gol(s) contra`, s.ownGoals * cfg.ownGoal);
  add(`${s.penaltiesMissed} pênalti(s) perdido(s)`, s.penaltiesMissed * cfg.penaltyMissed);

  return { points: breakdown.reduce((sum, l) => sum + l.points, 0), cleanSheet, breakdown };
}

/**
 * Converte a partida normalizada em estatísticas por jogador.
 * Gols sofridos são derivados da linha do tempo: conta os gols contra o clube do jogador
 * marcados enquanto ele estava em campo (titular: 0→minutos; reserva: fim−minutos→fim).
 */
export function deriveRawStats(detail: MatchDetail): Map<number, { clubId: number; stats: RawPlayerStats }> {
  const matchLength = new Map<number, number>();
  for (const p of detail.players) {
    matchLength.set(p.clubId, Math.max(matchLength.get(p.clubId) ?? 90, p.minutes));
  }
  const ownGoals = new Map<number, number>();
  for (const g of detail.goals) {
    if (g.ownGoalPlayerId !== null) ownGoals.set(g.ownGoalPlayerId, (ownGoals.get(g.ownGoalPlayerId) ?? 0) + 1);
  }

  const result = new Map<number, { clubId: number; stats: RawPlayerStats }>();
  for (const p of detail.players) {
    const end = matchLength.get(p.clubId) ?? 90;
    const on = p.substitute ? end - p.minutes : 0;
    const off = p.substitute ? end : p.minutes;
    const goalsConceded =
      p.minutes === 0
        ? 0
        : detail.goals.filter((g) => {
            if (g.concedingClubId !== p.clubId) return false;
            const minute = Math.min(g.minute, end);
            return minute > on && minute <= off;
          }).length;
    result.set(p.playerId, {
      clubId: p.clubId,
      stats: {
        minutes: p.minutes,
        goals: p.goals,
        assists: p.assists,
        ownGoals: ownGoals.get(p.playerId) ?? 0,
        yellowCards: p.yellowCards,
        redCards: p.redCards,
        saves: p.saves,
        goalsConceded,
        penaltiesSaved: p.penaltiesSaved,
        penaltiesMissed: p.penaltiesMissed,
      },
    });
  }
  return result;
}
