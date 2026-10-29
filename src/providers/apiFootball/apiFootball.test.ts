import { describe, expect, it, vi } from "vitest";
import { deriveRawStats } from "@/domain/scoring";
import type { ResponseCache } from "../types";
import { mapFixtures, mapMatchDetails, mapRound, mapSquad, mapStatus } from "./mapper";
import { ApiFootballProvider } from "./provider";

const fixture = (id: number, round: string, date: string, home: number, away: number, status = "FT") => ({
  fixture: { id, date, status: { short: status } },
  league: { round },
  teams: { home: { id: home }, away: { id: away } },
  goals: { home: 1, away: 0 },
  score: { penalty: { home: null, away: null } },
});

// Formato documentado de GET /fixtures?ids=... (com events e players).
const detail = {
  ...fixture(900, "League Stage - 3", "2026-10-21T19:00:00+00:00", 10, 20),
  goals: { home: 2, away: 1 },
  events: [
    { time: { elapsed: 12, extra: null }, team: { id: 10 }, player: { id: 101 }, type: "Goal", detail: "Normal Goal" },
    { time: { elapsed: 40, extra: null }, team: { id: 10 }, player: { id: 102 }, type: "Goal", detail: "Penalty" },
    { time: { elapsed: 55, extra: null }, team: { id: 20 }, player: { id: 201 }, type: "Goal", detail: "Missed Penalty" },
    { time: { elapsed: 90, extra: 4 }, team: { id: 10 }, player: { id: 103 }, type: "Goal", detail: "Own Goal" },
    { time: { elapsed: 60, extra: null }, team: { id: 10 }, player: { id: 104 }, type: "Card", detail: "Yellow Card" },
  ],
  players: [
    {
      team: { id: 10 },
      players: [
        {
          player: { id: 101, name: "Atacante" },
          statistics: [{ games: { minutes: 90, substitute: false }, goals: { total: 1, assists: null, saves: null }, cards: { yellow: 0, red: 0 }, penalty: { saved: null, missed: 0 } }],
        },
        {
          player: { id: 103, name: "Zagueiro" },
          statistics: [{ games: { minutes: 90, substitute: false }, goals: { total: null, assists: 1, saves: null }, cards: { yellow: 0, red: 0 }, penalty: {} }],
        },
        {
          player: { id: 105, name: "Reserva não usado" },
          statistics: [{ games: { minutes: null, substitute: true }, goals: {}, cards: {}, penalty: {} }],
        },
      ],
    },
    {
      team: { id: 20 },
      players: [
        {
          player: { id: 200, name: "Goleiro" },
          statistics: [{ games: { minutes: 90, substitute: false }, goals: { total: 0, assists: 0, saves: 6 }, cards: { yellow: 1, red: 0 }, penalty: { saved: 0, missed: 0 } }],
        },
        {
          player: { id: 201, name: "Batedor" },
          statistics: [{ games: { minutes: 30, substitute: true }, goals: { total: 0 }, cards: {}, penalty: { missed: 1 } }],
        },
      ],
    },
  ],
};

describe("mapper da API-Football", () => {
  it("mapeia nomes de rodada e ignora qualificatórias", () => {
    expect(mapRound("League Stage - 8")).toEqual({ stage: "LEAGUE", leagueRound: 8 });
    expect(mapRound("Knockout Round Play-offs")).toEqual({ stage: "PLAYOFF" });
    expect(mapRound("Play-offs")).toBeNull();
    expect(mapRound("3rd Qualifying Round")).toBeNull();
    expect(mapRound("Final")).toEqual({ stage: "FINAL" });
  });

  it("mapeia status", () => {
    expect(mapStatus("NS")).toBe("SCHEDULED");
    expect(mapStatus("2H")).toBe("LIVE");
    expect(mapStatus("PEN")).toBe("FINISHED");
    expect(mapStatus("PST")).toBe("POSTPONED");
    expect(mapStatus("ABD")).toBe("CANCELLED");
  });

  it("separa ida e volta pela data dentro do confronto", () => {
    const fixtures = mapFixtures([
      fixture(2, "Round of 16", "2027-03-11T20:00:00Z", 5, 6),
      fixture(1, "Round of 16", "2027-03-04T20:00:00Z", 6, 5),
      fixture(3, "League Stage - 2", "2026-09-30T19:00:00Z", 5, 7),
      fixture(4, "Final", "2027-05-29T19:00:00Z", 5, 8),
      fixture(5, "Play-offs", "2026-08-20T19:00:00Z", 5, 9),
    ]);
    const byId = new Map(fixtures.map((f) => [f.id, f.roundOrder]));
    expect(byId).toEqual(
      new Map([
        [3, 2],
        [4, 17],
        [1, 11],
        [2, 12],
      ]),
    );
  });

  it("descarta jogadores sem posição", () => {
    const squad = mapSquad(
      [{ team: { id: 10 }, players: [{ id: 1, name: "A", position: "Attacker" }, { id: 2, name: "B", position: null }] }],
      10,
    );
    expect(squad).toEqual([{ id: 1, name: "A", position: "FWD", clubId: 10, photoUrl: null, injured: false }]);
  });

  it("normaliza o detalhe da partida e a linha do tempo de gols", () => {
    const [m] = mapMatchDetails([detail]);
    expect(m?.goals).toEqual([
      { minute: 12, concedingClubId: 20, ownGoalPlayerId: null },
      { minute: 40, concedingClubId: 20, ownGoalPlayerId: null },
      { minute: 94, concedingClubId: 10, ownGoalPlayerId: 103 },
    ]);
    expect(m?.players.find((p) => p.playerId === 105)?.minutes).toBe(0);
    expect(m?.players.find((p) => p.playerId === 201)?.penaltiesMissed).toBe(1);

    const stats = deriveRawStats(m!);
    expect(stats.get(103)?.stats).toMatchObject({ ownGoals: 1, assists: 1, goalsConceded: 1 });
    expect(stats.get(200)?.stats).toMatchObject({ saves: 6, goalsConceded: 2, yellowCards: 1 });
  });
});

describe("ApiFootballProvider", () => {
  function memoryCache(): ResponseCache {
    const store = new Map<string, { response: unknown; fetchedAt: Date }>();
    return {
      get: async (key) => store.get(key) ?? null,
      set: async (key, _endpoint, response) => void store.set(key, { response, fetchedAt: new Date() }),
    };
  }
  const ok = (response: unknown) => new Response(JSON.stringify({ errors: [], response }), { status: 200 });

  it("usa o cache e só busca partidas que faltam, em lotes de até 20", async () => {
    const fetchMock = vi.fn(async () => ok([detail]));
    const cache = memoryCache();
    const provider = new ApiFootballProvider({ apiKey: "k", season: 2026, leagueId: 2, minIntervalMs: 0, cache, fetch: fetchMock as typeof fetch });

    expect(await provider.getMatchDetails([900])).toHaveLength(1);
    expect(await provider.getMatchDetails([900])).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(provider.requestCount()).toBe(1);

    await provider.getMatchDetails([900], { fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const url = (fetchMock.mock.calls[0] as unknown as [URL])[0];
    expect(url.searchParams.get("ids")).toBe("900");
  });

  it("falha explicitamente quando a API devolve erro (ex.: temporada fora do plano)", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ errors: { plan: "Free plans do not have access to this season" }, response: [] })),
    );
    const provider = new ApiFootballProvider({ apiKey: "k", season: 2026, leagueId: 2, minIntervalMs: 0, cache: memoryCache(), fetch: fetchMock as typeof fetch });
    await expect(provider.getFixtures()).rejects.toThrow(/do not have access/);
  });
});
