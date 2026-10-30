import { dominantSub, type SubPosition } from "@/domain/subpositions";
import type { MatchDetail } from "@/domain/types";
import type { FootballDataProvider, HistoryMatch, MatchdaySquad, ProviderClub, ProviderCoach, ProviderFixture, ProviderPlayer, ResponseCache } from "../types";
import {
  lineupCoaches,
  lineupMatchdaySquad,
  lineupPlayers,
  lineupSubs,
  mapClubs,
  mapFixtures,
  mapLeagueStageRanks,
  mapMatchDetail,
  matchesSchema,
  roundOrderOf,
  type UefaMatch,
} from "./mapper";

const MATCH_API = "https://match.uefa.com";
const STATS_API = "https://matchstats.uefa.com";
const STANDINGS_API = "https://standings.uefa.com";
const HOUR = 3_600_000;
const PAGE = 500;

export interface UefaOptions {
  /** Ano em que a temporada termina: 2026/27 = 2027. */
  seasonYear: number;
  /** Champions League = 1. */
  competitionId: number;
  minIntervalMs: number;
  cache: ResponseCache;
  fetch?: typeof fetch;
  /** Temporada encerrada: a lista de partidas não muda mais (cache sem validade). */
  immutable?: boolean;
}

export class UefaError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const throttle = ((globalThis as { __uefaThrottle?: { chain: Promise<void>; lastAt: number } }).__uefaThrottle ??= {
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

/**
 * Dados reais da Champions direto dos endpoints públicos do site da UEFA (sem chave e sem custo).
 * Não são uma API oficial: podem mudar sem aviso. Toda resposta passa pelo cache do banco; súmulas
 * e estatísticas de partidas encerradas ficam em cache e só são buscadas de novo com `fresh: true`.
 *
 * Elencos: a UEFA não expõe a lista inscrita, então o elenco de cada clube são os jogadores
 * relacionados (titulares e reservas) nas súmulas já publicadas. Quem nunca foi relacionado entra
 * quando aparecer numa súmula.
 */
export class UefaProvider implements FootballDataProvider {
  readonly name = "uefa";
  private requests = 0;
  private squads: Promise<{ byClub: Map<number, ProviderPlayer[]>; coaches: ProviderCoach[] }> | null = null;

  constructor(private readonly options: UefaOptions) {}

  requestCount(): number {
    return this.requests;
  }

  private async request(url: URL): Promise<unknown> {
    await nextSlot(this.options.minIntervalMs);
    this.requests++;
    const res = await (this.options.fetch ?? fetch)(url, { headers: { accept: "application/json" } });
    // 404 = ainda não publicado (súmula/estatística de partida futura).
    if (res.status === 404) return null;
    if (!res.ok) throw new UefaError(`UEFA ${url.host}${url.pathname}: HTTP ${res.status}`);
    return res.json();
  }

  private async cached(key: string, url: URL, maxAgeMs: number, options: { fresh?: boolean; cacheOnly?: boolean; keep?: (r: unknown) => boolean } = {}) {
    if (!options.fresh) {
      const hit = await this.options.cache.get(key);
      if (hit && (options.cacheOnly || Date.now() - hit.fetchedAt.getTime() < maxAgeMs)) return hit.response;
      if (options.cacheOnly) return null;
    }
    const response = await this.request(url);
    if (response !== null && (options.keep?.(response) ?? true)) await this.options.cache.set(key, url.pathname, response);
    return response;
  }

  private url(base: string, path: string, params: Record<string, string | number> = {}) {
    const url = new URL(path, base);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    return url;
  }

  /** Todas as partidas da temporada (inclui qualificatórias, filtradas no mapper). */
  private async rawMatches(): Promise<UefaMatch[]> {
    const { competitionId, seasonYear } = this.options;
    const all: unknown[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await this.cached(
        `uefa:matches:${competitionId}:${seasonYear}:${offset}`,
        this.url(MATCH_API, "/v5/matches", { competitionId, seasonYear, order: "ASC", offset, limit: PAGE }),
        this.options.immutable ? Infinity : 30 * 60_000,
      );
      const items = Array.isArray(page) ? page : [];
      all.push(...items);
      if (items.length < PAGE) break;
    }
    return matchesSchema.parse(all);
  }

  async getClubs(): Promise<ProviderClub[]> {
    return mapClubs(await this.rawMatches());
  }

  async getFixtures(): Promise<ProviderFixture[]> {
    return mapFixtures(await this.rawMatches());
  }

  private async lineups(matchId: number, finished: boolean, options: { fresh?: boolean; cacheOnly?: boolean } = {}) {
    // Partida encerrada: a súmula não muda mais.
    return this.cached(`uefa:lineups:${matchId}`, this.url(MATCH_API, `/v5/matches/${matchId}/lineups`), finished ? Infinity : HOUR, options);
  }

  private async playerStats(matchId: number, options: { fresh?: boolean; cacheOnly?: boolean } = {}) {
    return this.cached(`uefa:pstats:${matchId}`, this.url(STATS_API, `/v1/player-statistics/${matchId}`), Infinity, {
      ...options,
      // Resposta vazia = estatística ainda não publicada: não guarda, tenta de novo depois.
      keep: (r) => Array.isArray(r) && r.length > 0,
    });
  }

  /** Elencos montados das súmulas, em ordem cronológica: a súmula mais recente define clube e posição. */
  private loadSquads() {
    this.squads ??= (async () => {
      const matches = (await this.rawMatches())
        .filter((m) => roundOrderOf(m) !== null && m.status === "FINISHED")
        .sort((a, b) => a.kickOffTime.dateTime.localeCompare(b.kickOffTime.dateTime));
      const players = new Map<number, ProviderPlayer>();
      const votes = new Map<number, Array<SubPosition | null>>();
      const coaches = new Map<number, ProviderCoach>();
      for (const m of matches) {
        const raw = await this.lineups(m.id, true);
        if (!raw) continue;
        for (const p of lineupPlayers(raw)) players.set(p.id, p);
        for (const v of lineupSubs(raw)) votes.set(v.playerId, [...(votes.get(v.playerId) ?? []), v.sub]);
        // A súmula mais recente de cada clube define o técnico atual.
        for (const c of lineupCoaches(raw)) coaches.set(c.clubId, c);
      }
      const byClub = new Map<number, ProviderPlayer[]>();
      for (const p of players.values()) {
        const squad = { ...p, subPosition: dominantSub(p.position, votes.get(p.id) ?? []) };
        byClub.set(p.clubId, [...(byClub.get(p.clubId) ?? []), squad]);
      }
      return { byClub, coaches: [...coaches.values()] };
    })();
    return this.squads;
  }

  async getCoaches(): Promise<ProviderCoach[]> {
    return (await this.loadSquads()).coaches;
  }

  /** Escalações já publicadas de partidas que ainda vão acontecer (ou estão rolando). */
  async getMatchdaySquads(matchIds: readonly number[]): Promise<MatchdaySquad[]> {
    const squads: MatchdaySquad[] = [];
    for (const id of matchIds) {
      const raw = await this.cached(`uefa:lineups-pre:${id}`, this.url(MATCH_API, `/v5/matches/${id}/lineups`), 10 * 60_000);
      const squad = raw ? lineupMatchdaySquad(id, raw) : null;
      if (squad) squads.push(squad);
    }
    return squads;
  }

  async getSquad(clubId: number): Promise<ProviderPlayer[]> {
    return (await this.loadSquads()).byClub.get(clubId) ?? [];
  }

  async getMatchDetails(matchIds: readonly number[], options: { fresh?: boolean; cacheOnly?: boolean } = {}): Promise<MatchDetail[]> {
    const byId = new Map((await this.rawMatches()).map((m) => [m.id, m]));
    const details: MatchDetail[] = [];
    for (const id of matchIds) {
      const match = byId.get(id);
      if (!match) continue;
      const finished = match.status === "FINISHED";
      const lineups = await this.lineups(id, finished, options);
      const stats = lineups ? await this.playerStats(id, options) : null;
      if (!lineups) continue;
      details.push(mapMatchDetail(match, lineups, stats ?? []));
    }
    return details;
  }

  /** Temporada anterior inteira (fase principal), com as súmulas e estatísticas de cada partida. */
  async getPreviousSeason(): Promise<{ seasonYear: number; matches: HistoryMatch[] }> {
    const seasonYear = this.options.seasonYear - 1;
    const prev = new UefaProvider({ ...this.options, seasonYear, immutable: true });
    const raw = (await prev.rawMatches()).filter((m) => roundOrderOf(m) !== null && m.status === "FINISHED");
    const details = new Map((await prev.getMatchDetails(raw.map((m) => m.id))).map((d) => [d.matchId, d]));
    this.requests += prev.requestCount();
    return {
      seasonYear,
      matches: raw.flatMap((m) => {
        const detail = details.get(m.id);
        return detail
          ? [{ roundOrder: roundOrderOf(m)!, kickoff: new Date(m.kickOffTime.dateTime), homeName: m.homeTeam.internationalName, awayName: m.awayTeam.internationalName, detail }]
          : [];
      }),
    };
  }

  async getLeagueStageRanks(): Promise<Map<number, number>> {
    const { competitionId, seasonYear } = this.options;
    const raw = await this.cached(
      `uefa:standings:${competitionId}:${seasonYear}`,
      this.url(STANDINGS_API, "/v1/standings", { competitionId, seasonYear }),
      6 * HOUR,
    );
    // Antes do fim da fase de liga a classificação é parcial: só vale com as 8 rodadas jogadas.
    const leaguePhase = (await this.rawMatches()).filter((m) => {
      const order = roundOrderOf(m);
      return order !== null && order <= 8;
    });
    const done = leaguePhase.length > 0 && leaguePhase.every((m) => m.status === "FINISHED");
    return done && raw ? mapLeagueStageRanks(raw) : new Map();
  }
}
