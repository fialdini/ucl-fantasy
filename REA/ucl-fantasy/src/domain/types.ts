import type { Position } from "@config/scoring";

export type { Position };
export type MatchStatus = "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED" | "CANCELLED";
export type Slot = "STARTER" | "BENCH";

/** Scouts que vêm direto da súmula do jogador (sem derivação). */
export interface PlayerScouts {
  goals: number;
  assists: number;
  /** Chutes em direção ao gol (no alvo). */
  shotsOnTarget: number;
  /** Chutes na trave. */
  shotsWoodwork: number;
  /** Chutes para fora ou bloqueados. */
  shotsOffTarget: number;
  tackles: number;
  /** Bolas recuperadas (inclui interceptações). */
  ballsRecovered: number;
  /** Dribles bem-sucedidos. */
  dribbles: number;
  passesCompleted: number;
  passesMissed: number;
  offsides: number;
  foulsCommitted: number;
  foulsSuffered: number;
  penaltiesWon: number;
  penaltiesConceded: number;
  yellowCards: number;
  redCards: number;
  saves: number;
  penaltiesSaved: number;
  penaltiesMissed: number;
}

/** Estatística bruta de um jogador numa partida — tudo o que a pontuação precisa. */
export interface RawPlayerStats extends PlayerScouts {
  minutes: number;
  ownGoals: number;
  goalsConceded: number;
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
  players: Array<
    PlayerScouts & {
      playerId: number;
      clubId: number;
      name: string;
      /** Posição na súmula, quando a fonte informa (usada para cadastrar jogadores novos). */
      position?: Position | null;
      minutes: number;
      /** true = entrou vindo do banco. */
      substitute: boolean;
    }
  >;
  goals: Array<{ minute: number; concedingClubId: number; ownGoalPlayerId: number | null }>;
}

export interface RosterPlayer {
  playerId: number;
  position: Position;
  clubId: number;
  slot: Slot;
}
