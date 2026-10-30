/**
 * Tabela de pontuação, baseada na do Cartola FC (valores vigentes desde 2022).
 * Altere aqui — nenhum valor de pontuação existe fora deste arquivo.
 * Depois de alterar, use "Recalcular pontos" no painel do comissário (não chama a API).
 */
export type Position = "GK" | "DEF" | "MID" | "FWD";

/** Pontua a cada `per` ocorrências (ex.: +0,5 a cada 10 passes certos). */
export interface Every {
  per: number;
  points: number;
}

export interface ScoringConfig {
  appearance: { minMinutes: number; fullMinutes: number; partial: number; full: number };
  goal: Record<Position, number>;
  assist: number;
  /** Finalização defendida: chute no gol que não virou gol. */
  shotSaved: number;
  shotWoodwork: number;
  shotOffTarget: number;
  foulSuffered: number;
  penaltyWon: number;
  dribble: number;
  passesCompleted: Every;
  passesMissed: Every & { positions: Position[] };
  offside: number;
  tackle: number;
  ballRecovered: number;
  cleanSheet: { minMinutes: number; points: Record<Position, number> };
  saves: Every & { positions: Position[] };
  penaltySaved: number;
  goalsConceded: Every & { positions: Position[] };
  foulsCommitted: Every;
  penaltyConceded: number;
  yellowCard: number;
  redCard: number;
  ownGoal: number;
  penaltyMissed: number;
}

export const scoring: ScoringConfig = {
  // O Cartola não pontua tempo em campo: só os scouts.
  appearance: { minMinutes: 1, fullMinutes: 60, partial: 0, full: 0 },

  // ---- Ataque (Cartola) ----
  goal: { GK: 8, DEF: 8, MID: 8, FWD: 8 }, // G
  assist: 5, // A
  // FT. A API-Football não informa bola na trave: só pontua com fontes que trazem.
  shotWoodwork: 3,
  shotSaved: 1.2, // FD
  shotOffTarget: 0.8, // FF (inclui chutes bloqueados)
  foulSuffered: 0.5, // FS
  penaltyWon: 1, // PS
  // PP. A finalização do pênalti perdido soma à parte (trave, defendida ou para fora), como no Cartola.
  penaltyMissed: -4,
  offside: -0.1, // I
  // PI: passe incompleto. O Cartola não desconta do goleiro.
  passesMissed: { per: 1, points: -0.1, positions: ["DEF", "MID", "FWD"] },

  // ---- Fora do Cartola (scouts extras deste jogo) ----
  // Médias por jogo (60+ min) nas rodadas 1–3 da Champions 2026/27, dados da UEFA:
  // só Cartola: GOL 2,6 · DEF 2,7 · MEI 3,5 · ATA 6,0 | com os extras: GOL 3,0 · DEF 6,0 · MEI 6,4 · ATA 8,4.
  // A bola recuperada é o que mais compensa os defensores.
  passesCompleted: { per: 20, points: 0.3 },
  dribble: 1,
  ballRecovered: 0.5, // inclui interceptações


  // ---- Defesa (Cartola) ----
  tackle: 1.2, // DS
  // SG: goleiros e defensores (zagueiros e laterais). Exige 60+ minutos em campo.
  cleanSheet: { minMinutes: 60, points: { GK: 5, DEF: 5, MID: 0, FWD: 0 } },
  saves: { per: 1, points: 1, positions: ["GK"] }, // DE
  penaltySaved: 7, // DP
  goalsConceded: { per: 1, points: -1, positions: ["GK"] }, // GS

  // ---- Punições (Cartola) ----
  foulsCommitted: { per: 1, points: -0.3 }, // FC
  penaltyConceded: -1, // PC
  yellowCard: -1, // CA
  redCard: -3, // CV
  ownGoal: -3, // GC
};

/**
 * Técnico. A tabela oficial do técnico no Cartola não está publicada de forma que eu consiga conferir,
 * então esta é uma aproximação com a mesma ideia: o técnico pontua pelo desempenho do time na partida.
 * Pontos = média dos pontos dos jogadores do clube que atuaram (mínimo `minMinutes`) + bônus de resultado.
 * Ajuste aqui e use "Recalcular pontos".
 */
export const managerScoring = {
  minMinutes: 45,
  win: 3,
  draw: 1,
  loss: -1,
  /** Bônus por jogo sem sofrer gol. */
  cleanSheet: 1,
};
