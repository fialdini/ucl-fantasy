import { scoring as defaultScoring, type Every, type ScoringConfig } from "@config/scoring";
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

/** Pontos com até 2 casas decimais, sem resíduo de ponto flutuante (0,1 + 0,2 = 0,3). */
export const roundPoints = (n: number) => Math.round(n * 100) / 100;

export function computePoints(position: Position, s: RawPlayerStats, cfg: ScoringConfig = defaultScoring): PlayerScore {
  const breakdown: ScoreLine[] = [];
  const add = (label: string, points: number) => {
    const rounded = roundPoints(points);
    if (rounded !== 0) breakdown.push({ label, points: rounded });
  };

  const every = (count: number, rule: Every) => Math.floor(count / rule.per) * rule.points;
  // Finalização defendida = chute no gol que não virou gol.
  const shotsSaved = Math.max(s.shotsOnTarget - s.goals, 0);

  if (s.minutes >= cfg.appearance.fullMinutes) add(`Jogou ${s.minutes} min`, cfg.appearance.full);
  else if (s.minutes >= cfg.appearance.minMinutes) add(`Jogou ${s.minutes} min`, cfg.appearance.partial);

  add(`${s.goals} gol(s)`, s.goals * cfg.goal[position]);
  add(`${s.assists} assistência(s)`, s.assists * cfg.assist);
  add(`${s.shotsWoodwork} finalização(ões) na trave`, s.shotsWoodwork * cfg.shotWoodwork);
  add(`${shotsSaved} finalização(ões) defendida(s)`, shotsSaved * cfg.shotSaved);
  add(`${s.shotsOffTarget} finalização(ões) para fora`, s.shotsOffTarget * cfg.shotOffTarget);
  add(`${s.foulsSuffered} falta(s) sofrida(s)`, s.foulsSuffered * cfg.foulSuffered);
  add(`${s.penaltiesWon} pênalti(s) sofrido(s)`, s.penaltiesWon * cfg.penaltyWon);
  add(`${s.dribbles} drible(s) certo(s)`, s.dribbles * cfg.dribble);
  add(`${s.passesCompleted} passe(s) certo(s)`, every(s.passesCompleted, cfg.passesCompleted));
  if (cfg.passesMissed.positions.includes(position)) {
    add(`${s.passesMissed} passe(s) incompleto(s)`, every(s.passesMissed, cfg.passesMissed));
  }
  add(`${s.offsides} impedimento(s)`, s.offsides * cfg.offside);
  add(`${s.tackles} desarme(s)`, s.tackles * cfg.tackle);
  add(`${s.ballsRecovered} bola(s) recuperada(s)`, s.ballsRecovered * cfg.ballRecovered);

  const cleanSheet = s.minutes >= cfg.cleanSheet.minMinutes && s.goalsConceded === 0;
  if (cleanSheet) add("Jogo sem sofrer gol", cfg.cleanSheet.points[position]);

  if (cfg.saves.positions.includes(position)) add(`${s.saves} defesa(s)`, every(s.saves, cfg.saves));
  if (position === "GK") add(`${s.penaltiesSaved} pênalti(s) defendido(s)`, s.penaltiesSaved * cfg.penaltySaved);
  if (cfg.goalsConceded.positions.includes(position)) {
    add(`${s.goalsConceded} gol(s) sofrido(s)`, every(s.goalsConceded, cfg.goalsConceded));
  }

  add(`${s.foulsCommitted} falta(s) cometida(s)`, every(s.foulsCommitted, cfg.foulsCommitted));
  add(`${s.penaltiesConceded} pênalti(s) cometido(s)`, s.penaltiesConceded * cfg.penaltyConceded);
  add(`${s.yellowCards} amarelo(s)`, s.yellowCards * cfg.yellowCard);
  add(`${s.redCards} vermelho(s)`, s.redCards * cfg.redCard);
  add(`${s.ownGoals} gol(s) contra`, s.ownGoals * cfg.ownGoal);
  add(`${s.penaltiesMissed} pênalti(s) perdido(s)`, s.penaltiesMissed * cfg.penaltyMissed);

  return { points: roundPoints(breakdown.reduce((sum, l) => sum + l.points, 0)), cleanSheet, breakdown };
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
    const { playerId, clubId, name: _name, position: _position, substitute: _substitute, ...scouts } = p;
    result.set(playerId, {
      clubId,
      stats: { ...scouts, ownGoals: ownGoals.get(playerId) ?? 0, goalsConceded },
    });
  }
  return result;
}
