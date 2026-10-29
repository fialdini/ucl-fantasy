import type { MatchDetail, MatchStatus, Position } from "@/domain/types";

export interface ProviderClub {
  id: number;
  name: string;
  shortName: string;
  logoUrl: string | null;
}

export interface ProviderPlayer {
  id: number;
  name: string;
  position: Position;
  clubId: number;
  photoUrl: string | null;
  injured: boolean;
}

export interface ProviderFixture {
  id: number;
  /** Rodada fantasy (1–17); o provider resolve ida/volta. */
  roundOrder: number;
  homeClubId: number;
  awayClubId: number;
  kickoff: Date;
  status: MatchStatus;
  homeGoals: number | null;
  awayGoals: number | null;
  homePenalties: number | null;
  awayPenalties: number | null;
}

/**
 * Fonte de dados do jogo. Trocar de fornecedor = escrever outra implementação desta interface.
 * Toda resposta de rede deve passar por `ResponseCache` (ver http cache) — recalcular pontos nunca chama a API.
 */
export interface FootballDataProvider {
  readonly name: string;
  getClubs(): Promise<ProviderClub[]>;
  getSquad(clubId: number): Promise<ProviderPlayer[]>;
  getFixtures(): Promise<ProviderFixture[]>;
  /** `fresh: true` ignora o cache (reprocessamento no fechamento da rodada). */
  getMatchDetails(matchIds: readonly number[], options?: { fresh?: boolean }): Promise<MatchDetail[]>;
  /** Posição final de cada clube na fase de liga (clubId → 1..36). */
  getLeagueStageRanks(): Promise<Map<number, number>>;
  /** Requisições de rede feitas por esta instância (para o log de sincronização). */
  requestCount(): number;
}

export interface ResponseCache {
  get(key: string): Promise<{ response: unknown; fetchedAt: Date } | null>;
  set(key: string, endpoint: string, response: unknown): Promise<void>;
}
