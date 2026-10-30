import type { SubPosition } from "@/domain/subpositions";
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
  /** Sub-posição, quando a fonte permite deduzir (senão o padrão da posição). */
  subPosition?: SubPosition;
  injured: boolean;
  /**
   * Previsão de retorno da lesão. `undefined` = a fonte de elencos não informa lesões
   * (elas vêm de outra fonte, ver providers/injuries) e a sincronização não mexe nelas.
   */
  injuryReturn?: string | null;
  /** AAAA-MM-DD, quando a fonte informa (cruzamento com a fonte de lesões). */
  birthDate?: string | null;
}

export interface ProviderCoach {
  id: number;
  name: string;
  clubId: number;
  photoUrl: string | null;
}

/** Quem foi relacionado (titulares + banco) por clube numa partida, quando a escalação já saiu. */
export interface MatchdaySquad {
  matchId: number;
  clubs: Map<number, Set<number>>;
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
  /** Prefixo das chaves atuais no cache: entradas desta fonte fora dele são de versões antigas e são apagadas. */
  readonly cacheKeyPrefix?: string;
  getClubs(): Promise<ProviderClub[]>;
  getSquad(clubId: number): Promise<ProviderPlayer[]>;
  getFixtures(): Promise<ProviderFixture[]>;
  /**
   * `fresh: true` ignora o cache (reprocessamento no fechamento da rodada).
   * `cacheOnly: true` nunca chama a rede: partidas fora do cache ficam de fora do resultado.
   */
  getMatchDetails(matchIds: readonly number[], options?: { fresh?: boolean; cacheOnly?: boolean }): Promise<MatchDetail[]>;
  /** Técnicos atuais dos clubes (da súmula mais recente de cada um). Opcional. */
  getCoaches?(): Promise<ProviderCoach[]>;
  /**
   * Relacionados de partidas ainda não encerradas cuja escalação já foi publicada (a UEFA publica ~1h
   * antes). Partida sem escalação fica de fora. Opcional.
   */
  getMatchdaySquads?(matchIds: readonly number[]): Promise<MatchdaySquad[]>;
  /** Posição final de cada clube na fase de liga (clubId → 1..36). */
  getLeagueStageRanks(): Promise<Map<number, number>>;
  /** Requisições de rede feitas por esta instância (para o log de sincronização). */
  requestCount(): number;
  /** Temporada anterior, para o histórico na página do jogador. Opcional: nem toda fonte tem. */
  getPreviousSeason?(): Promise<{ seasonYear: number; matches: HistoryMatch[] }>;
}

export interface HistoryMatch {
  roundOrder: number;
  kickoff: Date;
  homeName: string;
  awayName: string;
  detail: MatchDetail;
}

export interface ResponseCache {
  get(key: string): Promise<{ response: unknown; fetchedAt: Date } | null>;
  set(key: string, endpoint: string, response: unknown): Promise<void>;
}
