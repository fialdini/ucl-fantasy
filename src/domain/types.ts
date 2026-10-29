import type { Position } from "@config/scoring";

export type { Position };
export type MatchStatus = "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED" | "CANCELLED";
export type Slot = "STARTER" | "BENCH";

/** Estatística bruta de um jogador numa partida — tudo o que a pontuação precisa. */
export interface RawPlayerStats {
  minutes: number;
  goals: number;
  assists: number;
  ownGoals: number;
  yellowCards: number;
  redCards: number;
  saves: number;
  goalsConceded: number;
  penaltiesSaved: number;
  penaltiesMissed: number;
}

/**
 * Partida normalizada entregue por qualquer provider (formato independente da fonte).
 * `goals` é a linha do tempo de gols, usada para derivar gols sofridos/clean sheet de cada jogador.
 */
export interface MatchDetail {
  matchId: number;
  homeClubId: number;
  awayClubId: number;
  status: MatchStatus;
  homeGoals: number | null;
  awayGoals: number | null;
  players: Array<{
    playerId: number;
    clubId: number;
    name: string;
    /** Posição na súmula, quando a fonte informa (usada para cadastrar jogadores novos). */
    position?: Position | null;
    minutes: number;
    /** true = entrou vindo do banco. */
    substitute: boolean;
    goals: number;
    assists: number;
    yellowCards: number;
    redCards: number;
    saves: number;
    penaltiesSaved: number;
    penaltiesMissed: number;
  }>;
  goals: Array<{ minute: number; concedingClubId: number; ownGoalPlayerId: number | null }>;
}

export interface RosterPlayer {
  playerId: number;
  position: Position;
  clubId: number;
  slot: Slot;
}
