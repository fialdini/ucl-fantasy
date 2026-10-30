import { managerScoring } from "@config/scoring";
import { roundPoints } from "./scoring";

export interface ManagerMatch {
  /** Gols do clube do técnico e do adversário. */
  goalsFor: number;
  goalsAgainst: number;
  /** Pontos dos jogadores do clube que atuaram o mínimo de minutos. */
  playerPoints: readonly number[];
}

/** Pontos do técnico numa partida: média do time + resultado + jogo sem sofrer gol (config/scoring.ts). */
export function managerPoints(m: ManagerMatch, cfg = managerScoring): { points: number; breakdown: Array<{ label: string; points: number }> } {
  const average = m.playerPoints.length ? m.playerPoints.reduce((s, p) => s + p, 0) / m.playerPoints.length : 0;
  const result = m.goalsFor > m.goalsAgainst ? cfg.win : m.goalsFor === m.goalsAgainst ? cfg.draw : cfg.loss;
  const breakdown = [
    { label: "Desempenho do time (média dos jogadores)", points: roundPoints(average) },
    { label: m.goalsFor > m.goalsAgainst ? "Vitória" : m.goalsFor === m.goalsAgainst ? "Empate" : "Derrota", points: result },
    ...(m.goalsAgainst === 0 ? [{ label: "Jogo sem sofrer gol", points: cfg.cleanSheet }] : []),
  ];
  return { points: roundPoints(breakdown.reduce((s, l) => s + l.points, 0)), breakdown };
}
