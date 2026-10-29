/**
 * Tabela de pontuação. Altere aqui — nenhum valor de pontuação existe fora deste arquivo.
 * Depois de alterar, use "Recalcular pontos" no painel do comissário (não chama a API).
 */
export type Position = "GK" | "DEF" | "MID" | "FWD";

export interface ScoringConfig {
  appearance: { minMinutes: number; fullMinutes: number; partial: number; full: number };
  goal: Record<Position, number>;
  assist: number;
  cleanSheet: { minMinutes: number; points: Record<Position, number> };
  saves: { per: number; points: number };
  penaltySaved: number;
  goalsConceded: { per: number; points: number; positions: Position[] };
  yellowCard: number;
  redCard: number;
  ownGoal: number;
  penaltyMissed: number;
}

export const scoring: ScoringConfig = {
  // 1–59 min: +1 | 60+ min: +2
  appearance: { minMinutes: 1, fullMinutes: 60, partial: 1, full: 2 },
  goal: { GK: 6, DEF: 6, MID: 5, FWD: 4 },
  assist: 3,
  // Clean sheet exige 60+ minutos em campo.
  cleanSheet: { minMinutes: 60, points: { GK: 4, DEF: 4, MID: 1, FWD: 0 } },
  // A cada 3 defesas (somente GOL): +1
  saves: { per: 3, points: 1 },
  penaltySaved: 5,
  // A cada 2 gols sofridos (GOL/DEF): −1
  goalsConceded: { per: 2, points: -1, positions: ["GK", "DEF"] },
  yellowCard: -1,
  redCard: -3,
  ownGoal: -2,
  penaltyMissed: -2,
};
