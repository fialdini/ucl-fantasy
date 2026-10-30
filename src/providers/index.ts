import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { apiCache } from "@/db/schema";
import { getSetting, setSetting } from "@/server/settings";
import { ApiFootballProvider } from "./apiFootball/provider";
import { MockProvider } from "./mock/provider";
import { ReplayProvider } from "./replay";
import { UefaProvider } from "./uefa/provider";
import type { FootballDataProvider, ResponseCache } from "./types";

export const MOCK_ANCHOR_KEY = "mock.anchor";
export const REPLAY_OFFSET_KEY = "replay.offsetMs";

export function dbResponseCache(db: Db, provider: string): ResponseCache {
  return {
    async get(key) {
      const [row] = await db.select().from(apiCache).where(eq(apiCache.key, key));
      return row ? { response: row.response, fetchedAt: row.fetchedAt } : null;
    },
    async set(key, endpoint, response) {
      const fetchedAt = new Date();
      await db
        .insert(apiCache)
        .values({ key, provider, endpoint, response: response as object, fetchedAt })
        .onConflictDoUpdate({ target: apiCache.key, set: { response: response as object, fetchedAt } });
    },
  };
}

export type ProviderName = "mock" | "api-football" | "uefa";

export function providerName(): ProviderName {
  const name = process.env.DATA_PROVIDER;
  return name === "api-football" || name === "uefa" ? name : "mock";
}

/** Replay: temporada encerrada reapresentada no tempo atual (para testar com dados reais). */
export function isReplay(): boolean {
  return providerName() === "api-football" && process.env.API_FOOTBALL_REPLAY === "true";
}

/** Modos em que o relógio da temporada pode ser adiantado pelo painel do comissário. */
export function isSimulated(): boolean {
  return providerName() === "mock" || isReplay();
}

/** Provider configurado por ambiente. `now` só afeta mock e replay (testes controlam o relógio). */
export async function getProvider(db: Db, now: () => Date = () => new Date()): Promise<FootballDataProvider> {
  if (providerName() === "uefa") {
    return new UefaProvider({
      seasonYear: Number(process.env.UEFA_SEASON_YEAR ?? 2027),
      competitionId: Number(process.env.UEFA_COMPETITION_ID ?? 1),
      minIntervalMs: Number(process.env.UEFA_MIN_INTERVAL_MS ?? 400),
      cache: dbResponseCache(db, "uefa"),
    });
  }
  if (providerName() === "api-football") {
    const apiKey = process.env.API_FOOTBALL_KEY;
    if (!apiKey) throw new Error("API_FOOTBALL_KEY não configurada");
    const real = new ApiFootballProvider({
      apiKey,
      season: Number(process.env.API_FOOTBALL_SEASON ?? 2026),
      leagueId: Number(process.env.API_FOOTBALL_LEAGUE_ID ?? 2),
      minIntervalMs: Number(process.env.API_FOOTBALL_MIN_INTERVAL_MS ?? 6500),
      batchIds: process.env.API_FOOTBALL_BATCH_IDS !== "false",
      immutable: isReplay(),
      cache: dbResponseCache(db, "api-football"),
    });
    if (!isReplay()) return real;
    return new ReplayProvider(real, {
      offsetMs: await getSetting<number>(db, REPLAY_OFFSET_KEY),
      saveOffset: (offset) => setSetting(db, REPLAY_OFFSET_KEY, offset),
      now,
    });
  }
  let anchor = await getSetting<string>(db, MOCK_ANCHOR_KEY);
  if (!anchor) {
    anchor = defaultMockAnchor(now()).toISOString();
    await setSetting(db, MOCK_ANCHOR_KEY, anchor);
  }
  return new MockProvider({ anchor: new Date(anchor), now });
}

/** Rodada 1 encerrada há alguns dias e rodada 2 começando em 2 dias. */
export function defaultMockAnchor(now: Date): Date {
  const anchor = new Date(now.getTime() - 5 * 86_400_000);
  anchor.setUTCMinutes(0, 0, 0);
  return anchor;
}

/** Adianta o relógio da temporada simulada (mock ou replay) em `ms`: tudo acontece `ms` mais cedo. */
export async function advanceSimulationClock(db: Db, ms: number): Promise<void> {
  if (providerName() === "mock") {
    await getProvider(db);
    const anchor = new Date((await getSetting<string>(db, MOCK_ANCHOR_KEY))!);
    await setSetting(db, MOCK_ANCHOR_KEY, new Date(anchor.getTime() - ms).toISOString());
    return;
  }
  const provider = await getProvider(db);
  await provider.getFixtures(); // garante que o deslocamento padrão foi calculado
  const offset = (await getSetting<number>(db, REPLAY_OFFSET_KEY)) ?? 0;
  await setSetting(db, REPLAY_OFFSET_KEY, offset - ms);
}
