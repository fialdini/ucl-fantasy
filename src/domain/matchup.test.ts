import { describe, expect, it } from "vitest";
import {
  computeStandings,
  matchupWinner,
  playoffSemis,
  roundRobinSchedule,
  teamScore,
  waiverOrder,
  type StarterInput,
} from "./matchup";

const finished = { status: "FINISHED" as const, statsStatus: "FINAL" as const };

describe("teamScore", () => {
  it("soma os pontos oficiais dos titulares", () => {
    const starters: StarterInput[] = [
      { playerId: 1, match: finished, points: 8 },
      { playerId: 2, match: finished, points: -1 },
      { playerId: 3, match: finished, points: null }, // não entrou
      { playerId: 4, match: null, points: null }, // clube eliminado
    ];
    const score = teamScore(starters);
    expect(score.points).toBe(7);
    expect(score.awaitingData).toBe(false);
    expect(score.lines.map((l) => l.status)).toEqual(["SCORED", "SCORED", "DID_NOT_PLAY", "NO_MATCH"]);
  });

  it("não inventa pontos quando a partida acabou sem estatística oficial", () => {
    const score = teamScore([
      { playerId: 1, match: { status: "FINISHED", statsStatus: "NONE" }, points: null },
      { playerId: 2, match: finished, points: 5 },
    ]);
    expect(score.points).toBe(5);
    expect(score.awaitingData).toBe(true);
    expect(score.lines[0]?.status).toBe("AWAITING_DATA");
  });

  it("jogos não iniciados valem 0 sem bloquear", () => {
    const score = teamScore([{ playerId: 1, match: { status: "SCHEDULED", statsStatus: "NONE" }, points: null }]);
    expect(score).toMatchObject({ points: 0, awaitingData: false });
  });
});

describe("matchupWinner", () => {
  const regular = { kind: "REGULAR" as const, homeTeamId: 1, awayTeamId: 2 };
  const semi = { kind: "SEMI" as const, homeTeamId: 1, awayTeamId: 4 };

  it("vence quem fez mais pontos", () => {
    expect(matchupWinner(regular, 50, 40)).toBe(1);
    expect(matchupWinner(regular, 40, 50)).toBe(2);
  });

  it("temporada regular aceita empate", () => {
    expect(matchupWinner(regular, 45, 45)).toBeNull();
  });

  it("empate no playoff favorece a melhor campanha", () => {
    expect(matchupWinner(semi, 45, 45, new Map([[1, 1], [4, 4]]))).toBe(1);
    expect(matchupWinner({ ...semi, homeTeamId: 4, awayTeamId: 1 }, 45, 45, new Map([[1, 1], [4, 4]]))).toBe(1);
  });
});

describe("computeStandings", () => {
  it("ordena por aproveitamento e desempata por pontos marcados", () => {
    const rows = computeStandings(
      [1, 2, 3, 4],
      [
        { homeTeamId: 1, awayTeamId: 2, homePoints: 50, awayPoints: 40, winnerTeamId: 1 },
        { homeTeamId: 3, awayTeamId: 4, homePoints: 30, awayPoints: 30, winnerTeamId: null },
        { homeTeamId: 1, awayTeamId: 3, homePoints: 20, awayPoints: 60, winnerTeamId: 3 },
        { homeTeamId: 2, awayTeamId: 4, homePoints: 70, awayPoints: 10, winnerTeamId: 2 },
      ],
    );
    expect(rows.map((r) => r.teamId)).toEqual([3, 2, 1, 4]);
    expect(rows[0]).toMatchObject({ wins: 1, ties: 1, losses: 0, pointsFor: 90, pointsAgainst: 50 });
    expect(waiverOrder(rows)).toEqual([4, 1, 2, 3]);
  });
});

describe("roundRobinSchedule", () => {
  it("cada time enfrenta todos os outros uma vez por turno", () => {
    const teams = [1, 2, 3, 4, 5, 6];
    const schedule = roundRobinSchedule(teams, [1, 2, 3, 4, 5]);
    expect(schedule).toHaveLength(15);
    const pairs = new Set(schedule.map((m) => [m.homeTeamId, m.awayTeamId].sort().join("-")));
    expect(pairs.size).toBe(15);
    for (const r of [1, 2, 3, 4, 5]) {
      const playing = schedule.filter((m) => m.round === r).flatMap((m) => [m.homeTeamId, m.awayTeamId]);
      expect(new Set(playing).size).toBe(6);
    }
  });

  it("com número ímpar, um time folga por rodada", () => {
    const schedule = roundRobinSchedule([1, 2, 3, 4, 5, 6, 7], [1, 2, 3]);
    for (const r of [1, 2, 3]) expect(schedule.filter((m) => m.round === r)).toHaveLength(3);
  });

  it("repete o turno com mando invertido", () => {
    const schedule = roundRobinSchedule([1, 2], [1, 2]);
    expect(schedule).toEqual([
      { round: 1, homeTeamId: 1, awayTeamId: 2 },
      { round: 2, homeTeamId: 2, awayTeamId: 1 },
    ]);
  });
});

describe("playoffSemis", () => {
  it("cruza 1º×4º e 2º×3º", () => {
    const standings = [5, 3, 8, 1, 2].map((teamId) => ({
      teamId,
      wins: 0,
      ties: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
    }));
    expect(playoffSemis(standings)).toEqual([
      { homeTeamId: 5, awayTeamId: 1 },
      { homeTeamId: 3, awayTeamId: 8 },
    ]);
  });
});
