import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { apiCache } from "@/db/schema";
import { getSetting, setSetting } from "@/server/settings";
import { ApiFootballProvider } from "./apiFootball/provider";
import { MockProvider } from "./mock/provider";
import type { FootballDataProvider, ResponseCache } from "./types";

export const MOCK_ANCHOR_KEY = "mock.anchor";

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

export function providerName(): "mock" | "api-football" {
  return process.env.DATA_PROVIDER === "api-football" ? "api-football" : "mock";
}

/** Provider configurado por ambiente. `now` só afeta o mock (testes controlam o relógio). */
export async function getProvider(db: Db, now: () => Date = () => new Date()): Promise<FootballDataProvider> {
  if (providerName() === "api-football") {
    const apiKey = process.env.API_FOOTBALL_KEY;
    if (!apiKey) throw new Error("API_FOOTBALL_KEY não configurada");
    return new ApiFootballProvider({
      apiKey,
      season: Number(process.env.API_FOOTBALL_SEASON ?? 2026),
      leagueId: Number(process.env.API_FOOTBALL_LEAGUE_ID ?? 2),
      minIntervalMs: Number(process.env.API_FOOTBALL_MIN_INTERVAL_MS ?? 6500),
      cache: dbResponseCache(db, "api-football"),
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
