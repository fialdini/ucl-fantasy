import { describe, expect, it } from "vitest";
import { scoring, type ScoringConfig } from "@config/scoring";
import { computePoints, deriveRawStats } from "./scoring";
import type { MatchDetail, PlayerScouts, RawPlayerStats } from "./types";

const noScouts: PlayerScouts = {
  goals: 0,
  assists: 0,
  shotsOnTarget: 0,
  shotsWoodwork: 0,
  shotsOffTarget: 0,
  tackles: 0,
  ballsRecovered: 0,
  dribbles: 0,
  passesCompleted: 0,
  passesMissed: 0,
  offsides: 0,
  foulsCommitted: 0,
  foulsSuffered: 0,
  penaltiesWon: 0,
  penaltiesConceded: 0,
  yellowCards: 0,
  redCards: 0,
  saves: 0,
  penaltiesSaved: 0,
  penaltiesMissed: 0,
};
const zero: RawPlayerStats = { ...noScouts, minutes: 0, ownGoals: 0, goalsConceded: 0 };
const stats = (s: Partial<RawPlayerStats>): RawPlayerStats => ({ ...zero, ...s });

describe("computePoints (tabela do Cartola)", () => {
  const p = (pos: Parameters<typeof computePoints>[0], st: Partial<RawPlayerStats>) => computePoints(pos, stats({ minutes: 90, goalsConceded: 1, ...st })).points;

  it("não pontua quem não jogou nem pontua tempo em campo", () => {
    expect(computePoints("FWD", zero).points).toBe(0);
    expect(computePoints("GK", zero).cleanSheet).toBe(false);
    expect(p("FWD", {})).toBe(0);
  });

  it("G +8 para todas as posições e A +5", () => {
    for (const pos of ["GK", "DEF", "MID", "FWD"] as const) expect(p(pos, { goals: 1, shotsOnTarget: 1 })).toBe(8 - (pos === "GK" ? 1 : 0));
    expect(p("MID", { assists: 2 })).toBe(10);
  });

  it("finalizações: FT +3, FD +1,2 (chute no gol que não entrou), FF +0,8", () => {
    expect(p("FWD", { shotsWoodwork: 1 })).toBe(3);
    expect(p("FWD", { shotsOnTarget: 3, goals: 1 })).toBe(8 + 2.4);
    expect(p("FWD", { shotsOffTarget: 3 })).toBe(2.4);
  });

  it("FS +0,5, PS +1, I −0,1 e PP −4", () => {
    expect(p("FWD", { foulsSuffered: 3 })).toBe(1.5);
    expect(p("FWD", { penaltiesWon: 1 })).toBe(1);
    expect(p("FWD", { offsides: 3 })).toBe(-0.3);
    expect(p("FWD", { penaltiesMissed: 1 })).toBe(-4);
  });

  it("PI −0,1 por passe incompleto, exceto para o goleiro", () => {
    expect(p("MID", { passesMissed: 7 })).toBe(-0.7);
    expect(p("GK", { passesMissed: 7 })).toBe(-1);
  });

  it("DS +1,2; SG +5 para goleiro e defensores com 60+ min", () => {
    expect(p("DEF", { tackles: 3 })).toBe(3.6);
    expect(computePoints("GK", stats({ minutes: 90 })).points).toBe(5);
    expect(computePoints("DEF", stats({ minutes: 60 })).points).toBe(5);
    expect(computePoints("MID", stats({ minutes: 90 })).points).toBe(0);
    expect(computePoints("DEF", stats({ minutes: 59 })).cleanSheet).toBe(false);
  });

  it("goleiro: DE +1, DP +7, GS −1 por gol (só goleiro)", () => {
    expect(computePoints("GK", stats({ minutes: 90, goalsConceded: 2, saves: 4, penaltiesSaved: 1 })).points).toBe(4 + 7 - 2);
    expect(p("DEF", { saves: 3, goalsConceded: 3 })).toBe(0);
  });

  it("punições: FC −0,3, PC −1, CA −1, CV −3, GC −3", () => {
    expect(p("DEF", { foulsCommitted: 3 })).toBe(-0.9);
    expect(p("DEF", { penaltiesConceded: 1, yellowCards: 1, redCards: 1, ownGoals: 1 })).toBe(-1 - 1 - 3 - 3);
  });

  it("extras: +0,3 a cada 20 passes certos, drible +1, bola recuperada +0,5", () => {
    expect(p("MID", { passesCompleted: 45 })).toBe(0.6);
    expect(p("MID", { dribbles: 2, ballsRecovered: 3 })).toBe(3.5);
  });

  it("soma decimais sem resíduo de ponto flutuante", () => {
    const r = computePoints("MID", stats({ minutes: 90, goalsConceded: 1, shotsOffTarget: 1, offsides: 1, foulsCommitted: 1, passesMissed: 1 }));
    expect(r.points).toBe(0.3);
    expect(r.breakdown.map((l) => l.points)).toEqual([0.8, -0.1, -0.1, -0.3]);
  });

  it("usa a tabela passada por configuração", () => {
    const cfg: ScoringConfig = { ...scoring, goal: { GK: 1, DEF: 1, MID: 1, FWD: 1 }, appearance: { minMinutes: 1, fullMinutes: 45, partial: 0, full: 10 } };
    expect(computePoints("FWD", stats({ minutes: 50, goals: 3, goalsConceded: 1 }), cfg).points).toBe(13);
  });
});

describe("deriveRawStats", () => {
  const detail: MatchDetail = {
    matchId: 1,
    homeClubId: 10,
    awayClubId: 20,
    status: "FINISHED",
    homeGoals: 1,
    awayGoals: 2,
    players: [
      { ...noScouts, playerId: 1, clubId: 10, name: "GK casa", minutes: 90, substitute: false, saves: 4 },
      { ...noScouts, playerId: 2, clubId: 10, name: "DEF substituído", minutes: 55, substitute: false, tackles: 3 },
      { ...noScouts, playerId: 3, clubId: 10, name: "DEF que entrou", minutes: 35, substitute: true },
      { ...noScouts, playerId: 4, clubId: 20, name: "ATA fora", minutes: 90, substitute: false, goals: 1 },
      { ...noScouts, playerId: 5, clubId: 10, name: "Banco não usado", minutes: 0, substitute: false },
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

  it("repassa os scouts da súmula", () => {
    expect(derived.get(2)?.stats.tackles).toBe(3);
    expect(derived.get(1)?.stats).not.toHaveProperty("name");
  });

  it("gols nos acréscimos entram no fim da partida", () => {
    expect(derived.get(4)?.stats.goalsConceded).toBe(1);
  });
});
