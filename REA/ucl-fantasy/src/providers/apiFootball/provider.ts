import type { MatchDetail } from "@/domain/types";
import type { FootballDataProvider, ProviderClub, ProviderFixture, ProviderPlayer, ResponseCache } from "../types";
import { mapClubs, mapFixtures, mapLeagueStageRanks, mapMatchDetails, mapSquad } from "./mapper";

const BASE_URL = "https://v3.football.api-sports.io";
const HOUR = 3_600_000;
/** fixtures?ids= aceita no máximo 20 IDs por chamada. */
const IDS_PER_REQUEST = 20;

export interface ApiFootballOptions {
  apiKey: string;
  season: number;
  leagueId: number;
  minIntervalMs: number;
  /** false no plano grátis, que não aceita `ids`: busca uma partida por requisição. */
  batchIds?: boolean;
  /** Temporada encerrada: respostas nunca expiram no cache. */
  immutable?: boolean;
  cache: ResponseCache;
  fetch?: typeof fetch;
  /** Espera antes de tentar de novo após "limite por minuto" (429). */
  retryDelayMs?: number;
}

export class ApiFootballError extends Error {}

const MAX_RETRIES = 3;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ritmo de requisições compartilhado por todo o processo: o limite por minuto é da conta,
 * não de cada sincronização. Sobrevive ao hot reload do Next.
 */
const throttle = ((globalThis as { __apifThrottle?: { chain: Promise<void>; lastAt: number } }).__apifThrottle ??= {
  chain: Promise.resolve(),
  lastAt: 0,
});

function nextSlot(minIntervalMs: number): Promise<void> {
  const slot = throttle.chain.then(async () => {
    const wait = throttle.lastAt + minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    throttle.lastAt = Date.now();
  });
  throttle.chain = slot.catch(() => {});
  return slot;
}

const isRateLimit = (errors: unknown) =>
  typeof errors === "object" && errors !== null && !Array.isArray(errors) && "rateLimit" in errors;

/**
 * Provider real. Cada resposta é gravada no cache do banco; leituras dentro do prazo de validade
 * não chamam a API. Detalhes de partidas encerradas ficam em cache por partida e só são buscados
 * de novo com `fresh: true` (fechamento/reprocessamento da rodada).
 */
export class ApiFootballProvider implements FootballDataProvider {
  readonly name = "api-football";
  private requests = 0;

  constructor(private readonly options: ApiFootballOptions) {}

  requestCount(): number {
    return this.requests;
  }

  private async request(path: string, params: Record<string, string | number>): Promise<unknown> {
    const url = new URL(path, BASE_URL);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      await nextSlot(this.options.minIntervalMs);
      this.requests++;
      const res = await (this.options.fetch ?? fetch)(url, { headers: { "x-apisports-key": this.options.apiKey } });
      const body = res.ok ? ((await res.json()) as { errors?: unknown; response?: unknown }) : null;
      // Limite por minuto: espera e tenta de novo (o limite diário não se resolve esperando).
      if ((res.status === 429 || isRateLimit(body?.errors)) && attempt < MAX_RETRIES) {
        await sleep(this.options.retryDelayMs ?? 61_000);
        continue;
      }
      if (!res.ok) throw new ApiFootballError(`API-Football ${path}: HTTP ${res.status}`);
      const errors = body?.errors;
      const hasErrors = Array.isArray(errors) ? errors.length > 0 : errors && Object.keys(errors).length > 0;
      if (hasErrors) throw new ApiFootballError(`API-Football ${path}: ${JSON.stringify(errors)}`);
      return body?.response ?? [];
    }
  }

  private async cached(
    key: string,
    path: string,
    params: Record<string, string | number>,
    maxAgeMs: number,
    fresh = false,
  ): Promise<unknown> {
    if (!fresh) {
      const hit = await this.options.cache.get(key);
      if (hit && (this.options.immutable || Date.now() - hit.fetchedAt.getTime() < maxAgeMs)) return hit.response;
    }
    const response = await this.request(path, params);
    await this.options.cache.set(key, path, response);
    return response;
  }

  private get scope() {
    return { league: this.options.leagueId, season: this.options.season };
  }

  async getClubs(): Promise<ProviderClub[]> {
    const { league, season } = this.scope;
    return mapClubs(await this.cached(`apif:teams:${league}:${season}`, "/teams", this.scope, 24 * HOUR));
  }

  async getSquad(clubId: number): Promise<ProviderPlayer[]> {
    return mapSquad(await this.cached(`apif:squad:${clubId}`, "/players/squads", { team: clubId }, 24 * HOUR), clubId);
  }

  async getFixtures(): Promise<ProviderFixture[]> {
    const { league, season } = this.scope;
    return mapFixtures(await this.cached(`apif:fixtures:${league}:${season}`, "/fixtures", this.scope, 30 * 60_000));
  }

  async getMatchDetails(matchIds: readonly number[], options: { fresh?: boolean; cacheOnly?: boolean } = {}): Promise<MatchDetail[]> {
    const details: MatchDetail[] = [];
    const missing: number[] = [];
    for (const id of matchIds) {
      const hit = options.fresh ? null : await this.options.cache.get(`apif:fixture:${id}`);
      if (hit) details.push(...mapMatchDetails([hit.response]));
      else missing.push(id);
    }
    if (options.cacheOnly) return details;
    const perRequest = this.options.batchIds === false ? 1 : IDS_PER_REQUEST;
    for (let i = 0; i < missing.length; i += perRequest) {
      const batch = missing.slice(i, i + perRequest);
      const response = await this.request("/fixtures", perRequest === 1 ? { id: batch[0]! } : { ids: batch.join("-") });
      const items = Array.isArray(response) ? response : [];
      for (const item of items) {
        const [detail] = mapMatchDetails([item]);
        if (!detail) continue;
        // Só partidas encerradas entram no cache por partida (as demais mudam).
        if (detail.status === "FINISHED") await this.options.cache.set(`apif:fixture:${detail.matchId}`, "/fixtures", item);
        details.push(detail);
      }
    }
    return details;
  }

  async getLeagueStageRanks(): Promise<Map<number, number>> {
    const { league, season } = this.scope;
    return mapLeagueStageRanks(
      await this.cached(`apif:standings:${league}:${season}`, "/standings", this.scope, 6 * HOUR),
    );
  }
}
