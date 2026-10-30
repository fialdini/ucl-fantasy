import { describe, expect, it, vi } from "vitest";
import { deriveRawStats } from "@/domain/scoring";
import type { ResponseCache } from "../types";
import { lineupPlayers, mapFixtures, mapGoals, mapMatchDetail, matchSchema, roundOrderOf } from "./mapper";
import { UefaProvider } from "./provider";

// Formatos reais de match.uefa.com / matchstats.uefa.com (campos irrelevantes omitidos).
const team = (id: number, name: string) => ({ id: String(id), internationalName: name, teamCode: name.slice(0, 3).toUpperCase(), logoUrl: null });
const match = (over: Record<string, unknown> = {}) => ({
  id: "900",
  status: "FINISHED",
  kickOffTime: { dateTime: "2026-10-21T19:00:00Z" },
  homeTeam: team(10, "Casa"),
  awayTeam: team(20, "Fora"),
  round: { phase: "TOURNAMENT", metaData: { name: "League Phase" } },
  matchday: { sequenceNumber: "3" },
  score: { total: { home: 2, away: 1 } },
  playerEvents: {
    scorers: [
      { goalType: "SCORED", phase: "FIRST_HALF", teamId: "10", player: { id: "101" }, time: { minute: 45, injuryMinute: 3 } },
      { goalType: "PENALTY", phase: "SECOND_HALF", teamId: "20", player: { id: "201" }, time: { minute: 60 } },
      { goalType: "OWN", phase: "SECOND_HALF", teamId: "20", player: { id: "202" }, time: { minute: 90, injuryMinute: 2 } },
    ],
  },
  ...over,
});
const lp = (id: number, name: string, fieldPosition: string) => ({ player: { id: String(id), internationalName: name, fieldPosition } });
const lineups = {
  homeTeam: { team: { id: "10" }, field: [lp(100, "Goleiro Casa", "GOALKEEPER"), lp(101, "Atacante", "FORWARD")], bench: [lp(102, "Reserva", "DEFENDER"), lp(103, "Técnico?", "COACH")] },
  awayTeam: { team: { id: "20" }, field: [lp(200, "Goleiro Fora", "GOALKEEPER"), lp(201, "Batedor", "MIDFIELDER"), lp(202, "Zagueiro", "DEFENDER")], bench: [] },
};
const st = (playerId: number, values: Record<string, number>) => ({
  playerId: String(playerId),
  statistics: Object.entries(values).map(([name, value]) => ({ name, value: String(value) })),
});
const stats = [
  st(100, { minutes_played_official: 90, saves: 4 }),
  st(101, { minutes_played_official: 70, goals: 1, attempts_on_target: 2, attempts_off_target: 1, attempts_blocked: 1, woodwork: 1, passes_attempted: 20, passes_completed: 15, recovered_ball: 3, dribbling_successful: 2, offsides: 1, fouls_suffered: 2 }),
  st(102, { minutes_played_official: 20, tackles_won: 2 }),
  st(200, { minutes_played_official: 90, saves: 1, saves_on_penalty: 0 }),
  st(201, { minutes_played_official: 90, goals: 1, penalty_awarded: 1, fouls_committed: 3, yellow_cards: 1 }),
  st(202, { minutes_played_official: 90, penalty_conceded: 1 }),
];

describe("mapper da UEFA", () => {
  it("numera as rodadas e ignora qualificatórias", () => {
    const m = (round: object, extra: object = {}) => roundOrderOf(matchSchema.parse(match({ round, ...extra })));
    expect(m({ phase: "TOURNAMENT", metaData: { name: "League Phase" } }, { matchday: { sequenceNumber: "8" } })).toBe(8);
    expect(m({ phase: "TOURNAMENT", metaData: { name: "Knock-out Play-off" } }, { leg: { number: 2 } })).toBe(10);
    expect(m({ phase: "TOURNAMENT", metaData: { name: "Round of 16" } }, { leg: { number: 1 } })).toBe(11);
    expect(m({ phase: "TOURNAMENT", metaData: { name: "Semi-finals" } }, { leg: { number: 2 } })).toBe(16);
    expect(m({ phase: "TOURNAMENT", metaData: { name: "Final" } })).toBe(17);
    expect(m({ phase: "QUALIFYING", metaData: { name: "Play-Offs" } }, { leg: { number: 1 } })).toBeNull();
  });

  it("partida futura vem sem placar", () => {
    const [f] = mapFixtures([match({ status: "UPCOMING", score: { total: { home: 0, away: 0 } } })]);
    expect(f).toMatchObject({ id: 900, roundOrder: 3, status: "SCHEDULED", homeGoals: null, awayGoals: null });
  });

  it("linha do tempo: gol contra sofrido pelo próprio time, acréscimo do 1º tempo no minuto 45", () => {
    expect(mapGoals(matchSchema.parse(match()))).toEqual([
      { minute: 45, concedingClubId: 20, ownGoalPlayerId: null },
      { minute: 60, concedingClubId: 10, ownGoalPlayerId: null },
      { minute: 92, concedingClubId: 20, ownGoalPlayerId: 202 },
    ]);
  });

  it("elenco vem das súmulas e descarta quem não tem posição de jogador", () => {
    const players = lineupPlayers(lineups);
    expect(players.map((p) => [p.id, p.position, p.clubId])).toEqual([
      [100, "GK", 10],
      [101, "FWD", 10],
      [102, "DEF", 10],
      [200, "GK", 20],
      [201, "MID", 20],
      [202, "DEF", 20],
    ]);
  });

  it("mapeia os scouts da UEFA e deriva gols sofridos pelo tempo em campo", () => {
    const d = mapMatchDetail(matchSchema.parse(match()), lineups, stats);
    expect(d.players.find((p) => p.playerId === 101)).toMatchObject({
      substitute: false,
      minutes: 70,
      goals: 1,
      shotsOnTarget: 2,
      shotsOffTarget: 2,
      shotsWoodwork: 1,
      passesCompleted: 15,
      passesMissed: 5,
      ballsRecovered: 3,
      dribbles: 2,
      offsides: 1,
      foulsSuffered: 2,
    });
    expect(d.players.find((p) => p.playerId === 102)).toMatchObject({ substitute: true, minutes: 20, tackles: 2 });
    expect(d.players.find((p) => p.playerId === 201)).toMatchObject({ penaltiesWon: 1, foulsCommitted: 3, yellowCards: 1 });
    const raw = deriveRawStats(d);
    expect(raw.get(100)?.stats.goalsConceded).toBe(1);
    // Reserva que entrou aos 70' não sofreu o gol dos 60'.
    expect(raw.get(102)?.stats.goalsConceded).toBe(0);
    expect(raw.get(202)?.stats).toMatchObject({ ownGoals: 1, goalsConceded: 2, penaltiesConceded: 1 });
  });

  it("sem estatística publicada, a partida fica sem jogadores (aguardando dados)", () => {
    expect(mapMatchDetail(matchSchema.parse(match()), lineups, []).players).toEqual([]);
  });
});

describe("UefaProvider", () => {
  function memoryCache() {
    const store = new Map<string, { response: unknown; fetchedAt: Date }>();
    const cache: ResponseCache = {
      get: async (key) => store.get(key) ?? null,
      set: async (key, _endpoint, response) => void store.set(key, { response, fetchedAt: new Date() }),
    };
    return { cache, store };
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it("usa o cache, não guarda estatística vazia e respeita cacheOnly", async () => {
    let statsReady = false;
    const fetchMock = vi.fn(async (url: URL) => {
      if (url.pathname === "/v5/matches") return json([match()]);
      if (url.pathname.endsWith("/lineups")) return json(lineups);
      if (url.pathname.startsWith("/v1/player-statistics")) return json(statsReady ? stats : []);
      return json({}, 404);
    });
    const { cache, store } = memoryCache();
    const provider = new UefaProvider({ seasonYear: 2027, competitionId: 1, minIntervalMs: 0, cache, fetch: fetchMock as unknown as typeof fetch });

    expect((await provider.getMatchDetails([900]))[0]?.players).toEqual([]);
    expect(store.has("uefa:pstats:900")).toBe(false);
    statsReady = true;
    expect((await provider.getMatchDetails([900]))[0]?.players.length).toBe(6);
    const calls = fetchMock.mock.calls.length;
    expect((await provider.getMatchDetails([900], { cacheOnly: true }))[0]?.players.length).toBe(6);
    expect(fetchMock.mock.calls.length).toBe(calls);
    expect(await provider.getSquad(10)).toHaveLength(3);
  });

  it("404 (ainda não publicado) não é erro", async () => {
    const fetchMock = vi.fn(async (url: URL) => (url.pathname === "/v5/matches" ? json([match({ status: "UPCOMING" })]) : json({}, 404)));
    const provider = new UefaProvider({ seasonYear: 2027, competitionId: 1, minIntervalMs: 0, cache: memoryCache().cache, fetch: fetchMock as unknown as typeof fetch });
    expect(await provider.getMatchDetails([900])).toEqual([]);
    expect(await provider.getLeagueStageRanks()).toEqual(new Map());
  });
});
