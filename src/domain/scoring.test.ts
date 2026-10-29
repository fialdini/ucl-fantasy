import { describe, expect, it } from "vitest";
import type { ScoringConfig } from "@config/scoring";
import { computePoints, deriveRawStats } from "./scoring";
import type { MatchDetail, RawPlayerStats } from "./types";

const zero: RawPlayerStats = {
  minutes: 0,
  goals: 0,
  assists: 0,
  ownGoals: 0,
  yellowCards: 0,
  redCards: 0,
  saves: 0,
  goalsConceded: 0,
  penaltiesSaved: 0,
  penaltiesMissed: 0,
};
const stats = (s: Partial<RawPlayerStats>): RawPlayerStats => ({ ...zero, ...s });

describe("computePoints", () => {
  it("não pontua quem não jogou", () => {
    expect(computePoints("FWD", zero).points).toBe(0);
    expect(computePoints("GK", zero).cleanSheet).toBe(false);
  });

  it("dá +1 para 1–59 minutos e +2 para 60+", () => {
    expect(computePoints("FWD", stats({ minutes: 1 })).points).toBe(1);
    expect(computePoints("FWD", stats({ minutes: 59 })).points).toBe(1);
    expect(computePoints("FWD", stats({ minutes: 60 })).points).toBe(2);
  });

  it("pontua gols por posição", () => {
    const m = { minutes: 90, goalsConceded: 1 };
    expect(computePoints("GK", stats({ ...m, goals: 1 })).points).toBe(2 + 6);
    expect(computePoints("DEF", stats({ ...m, goals: 1 })).points).toBe(2 + 6);
    expect(computePoints("MID", stats({ ...m, goals: 1 })).points).toBe(2 + 5);
    expect(computePoints("FWD", stats({ ...m, goals: 2 })).points).toBe(2 + 8);
  });

  it("pontua assistências", () => {
    expect(computePoints("FWD", stats({ minutes: 30, assists: 2 })).points).toBe(1 + 6);
  });

  it("clean sheet exige 60+ min e varia por posição", () => {
    expect(computePoints("GK", stats({ minutes: 90 })).points).toBe(2 + 4);
    expect(computePoints("DEF", stats({ minutes: 60 })).points).toBe(2 + 4);
    expect(computePoints("MID", stats({ minutes: 90 })).points).toBe(2 + 1);
    expect(computePoints("FWD", stats({ minutes: 90 })).points).toBe(2);
    expect(computePoints("DEF", stats({ minutes: 59 })).cleanSheet).toBe(false);
  });

  it("goleiro ganha +1 a cada 3 defesas e +5 por pênalti defendido", () => {
    const gk = computePoints("GK", stats({ minutes: 90, goalsConceded: 1, saves: 8, penaltiesSaved: 1 }));
    expect(gk.points).toBe(2 + 2 + 5);
    // defesas não contam para jogadores de linha
    expect(computePoints("DEF", stats({ minutes: 90, goalsConceded: 1, saves: 3 })).points).toBe(2);
  });

  it("tira −1 a cada 2 gols sofridos apenas de GOL/DEF", () => {
    expect(computePoints("GK", stats({ minutes: 90, goalsConceded: 1 })).points).toBe(2);
    expect(computePoints("DEF", stats({ minutes: 90, goalsConceded: 2 })).points).toBe(2 - 1);
    expect(computePoints("DEF", stats({ minutes: 90, goalsConceded: 5 })).points).toBe(2 - 2);
    expect(computePoints("MID", stats({ minutes: 90, goalsConceded: 4 })).points).toBe(2);
  });

  it("aplica cartões, gol contra e pênalti perdido", () => {
    expect(
      computePoints(
        "FWD",
        stats({ minutes: 70, yellowCards: 1, redCards: 1, ownGoals: 1, penaltiesMissed: 1 }),
      ).points,
    ).toBe(2 - 1 - 3 - 2 - 2);
  });

  it("detalha cada linha da pontuação", () => {
    const r = computePoints("MID", stats({ minutes: 90, goals: 1, assists: 1, yellowCards: 1 }));
    expect(r.breakdown.map((l) => l.points)).toEqual([2, 5, 3, 1, -1]);
    expect(r.points).toBe(10);
  });

  it("usa a tabela passada por configuração", () => {
    const cfg: ScoringConfig = {
      appearance: { minMinutes: 1, fullMinutes: 45, partial: 0, full: 10 },
      goal: { GK: 1, DEF: 1, MID: 1, FWD: 1 },
      assist: 0,
      cleanSheet: { minMinutes: 60, points: { GK: 0, DEF: 0, MID: 0, FWD: 0 } },
      saves: { per: 1, points: 1 },
      penaltySaved: 0,
      goalsConceded: { per: 1, points: 0, positions: [] },
      yellowCard: 0,
      redCard: 0,
      ownGoal: 0,
      penaltyMissed: 0,
    };
    expect(computePoints("FWD", stats({ minutes: 50, goals: 3 }), cfg).points).toBe(13);
  });
});

describe("deriveRawStats", () => {
  const base = { goals: 0, assists: 0, yellowCards: 0, redCards: 0, saves: 0, penaltiesSaved: 0, penaltiesMissed: 0 };
  const detail: MatchDetail = {
    matchId: 1,
    homeClubId: 10,
    awayClubId: 20,
    status: "FINISHED",
    homeGoals: 1,
    awayGoals: 2,
    players: [
      { ...base, playerId: 1, clubId: 10, name: "GK casa", minutes: 90, substitute: false, saves: 4 },
      { ...base, playerId: 2, clubId: 10, name: "DEF substituído", minutes: 55, substitute: false },
      { ...base, playerId: 3, clubId: 10, name: "DEF que entrou", minutes: 35, substitute: true },
      { ...base, playerId: 4, clubId: 20, name: "ATA fora", minutes: 90, substitute: false, goals: 1 },
      { ...base, playerId: 5, clubId: 10, name: "Banco não usado", minutes: 0, substitute: false },
    ],
    goals: [
      { minute: 20, concedingClubId: 10, ownGoalPlayerId: null },
      { minute: 70, concedingClubId: 10, ownGoalPlayerId: 3 },
      { minute: 93, concedingClubId: 20, ownGoalPlayerId: null },
    ],
  };
  const derived = deriveRawStats(detail);

  it("conta gols sofridos só enquanto o jogador estava em campo", () => {
    expect(derived.get(1)?.stats.goalsConceded).toBe(2);
    expect(derived.get(2)?.stats.goalsConceded).toBe(1);
    expect(derived.get(3)?.stats.goalsConceded).toBe(1);
    expect(derived.get(5)?.stats.goalsConceded).toBe(0);
  });

  it("atribui gols contra a quem os marcou", () => {
    expect(derived.get(3)?.stats.ownGoals).toBe(1);
    expect(derived.get(2)?.stats.ownGoals).toBe(0);
  });

  it("gols nos acréscimos entram no fim da partida", () => {
    expect(derived.get(4)?.stats.goalsConceded).toBe(1);
  });
});
