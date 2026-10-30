import type { Position } from "./scoring";

export type Stage = "LEAGUE" | "PLAYOFF" | "R16" | "QF" | "SF" | "FINAL";

/**
 * Rodadas fantasy = pernas reais da Champions. `order` é a chave estável usada em todo o app.
 */
export const competitionRounds: ReadonlyArray<{ order: number; stage: Stage; leg: 1 | 2 | null; name: string }> = [
  ...Array.from({ length: 8 }, (_, i) => ({
    order: i + 1,
    stage: "LEAGUE" as const,
    leg: null,
    name: `Fase de liga – Rodada ${i + 1}`,
  })),
  { order: 9, stage: "PLAYOFF", leg: 1, name: "Playoff – Ida" },
  { order: 10, stage: "PLAYOFF", leg: 2, name: "Playoff – Volta" },
  { order: 11, stage: "R16", leg: 1, name: "Oitavas – Ida" },
  { order: 12, stage: "R16", leg: 2, name: "Oitavas – Volta" },
  { order: 13, stage: "QF", leg: 1, name: "Quartas – Ida" },
  { order: 14, stage: "QF", leg: 2, name: "Quartas – Volta" },
  { order: 15, stage: "SF", leg: 1, name: "Semifinal – Ida" },
  { order: 16, stage: "SF", leg: 2, name: "Semifinal – Volta" },
  { order: 17, stage: "FINAL", leg: null, name: "Final" },
];

export const game = {
  league: { minTeams: 6, maxTeams: 12 },

  roster: {
    /** Tamanho do elenco no draft e máximo depois dele (trocas desiguais podem deixar vagas). */
    /** 11 titulares + 8 reservas. */
    size: 19,
    starters: { GK: 1, DEF: 4, MID: 4, FWD: 2 } satisfies Record<Position, number>,
    /** Banco do draft: cota final 2 GOL, 6 DEF, 7 MEI, 4 ATA — cobre todas as formações (5-3-2, 3-5-2, 4-3-3…). */
    bench: { GK: 1, DEF: 2, MID: 3, FWD: 2 } satisfies Record<Position, number>,
    /** Máximo por posição depois do draft. */
    maxPerPosition: { GK: 3, DEF: 8, MID: 8, FWD: 6 } satisfies Record<Position, number>,
    /** Máximo de jogadores do mesmo clube, por fase. Sobe após a fase de liga para aliviar a escassez. */
    clubCap: (roundOrder: number) => (roundOrder <= 8 ? 3 : 4),
  },

  /** Formações que o time pode escolher (titulares por posição; sempre 11). */
  formations: {
    "4-4-2": { GK: 1, DEF: 4, MID: 4, FWD: 2 },
    "4-3-3": { GK: 1, DEF: 4, MID: 3, FWD: 3 },
    "3-5-2": { GK: 1, DEF: 3, MID: 5, FWD: 2 },
    "4-5-1": { GK: 1, DEF: 4, MID: 5, FWD: 1 },
    "5-3-2": { GK: 1, DEF: 5, MID: 3, FWD: 2 },
  } satisfies Record<string, Record<Position, number>>,
  defaultFormation: "4-4-2",

  /** 60s por pick. DRAFT_PICK_SECONDS só para testes locais. */
  draft: { pickSeconds: Number(process.env.DRAFT_PICK_SECONDS) || 60 },

  /**
   * Temporada regular: da rodada de início da liga até a volta do playoff (rodada 10).
   * Playoffs fantasy (top 4) somam as duas pernas de cada fase real:
   *   semifinal fantasy = oitavas (11+12), final fantasy = quartas (13+14).
   * Semi e final da Champions ficam fora: com posse exclusiva não há jogadores ativos suficientes.
   */
  season: {
    regularSeasonLastRound: 10,
    playoffTeams: 4,
    playoffs: [
      { kind: "SEMI" as const, fromRound: 11, toRound: 12 },
      { kind: "FINAL" as const, fromRound: 13, toRound: 14 },
    ],
  },

  trades: {
    /** Última rodada em que trocas entre times podem ser concluídas (fim da temporada regular). */
    lastRound: 10,
    /** Máximo de jogadores de cada lado de uma proposta. */
    maxPlayersPerSide: 4,
  },

  waivers: {
    /** Horas entre o fechamento da rodada e o processamento dos pedidos de waiver. */
    windowHours: 24,
    /** Rodadas cujo fechamento abre a "repescagem de elenco" (ordem snake, drops livres de eliminados). */
    repechageAfterRounds: [8, 10],
  },

  sync: {
    /** Após o fim da última partida, espera este tempo antes de fechar a rodada (correções da fonte). */
    closeDelayHours: 24,
    /** Minutos após o apito inicial para considerar uma partida como possivelmente encerrada. */
    matchDurationMinutes: 150,
    calendarEveryHours: 12,
    squadsEveryHours: 24,
  },
} as const;

export type PlayoffKind = (typeof game.season.playoffs)[number]["kind"];
