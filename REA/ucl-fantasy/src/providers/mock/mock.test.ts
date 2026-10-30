import { describe, expect, it } from "vitest";
import { MockProvider } from "./provider";
import { MockSeason } from "./season";

const season = new MockSeason();

describe("MockSeason", () => {
  it("tem 36 clubes com 25 jogadores cada", () => {
    expect(season.clubs).toHaveLength(36);
    for (const club of season.clubs) expect(season.squads.get(club.id)).toHaveLength(25);
  });

  it("fase de liga: 18 jogos por rodada e 8 adversários distintos por clube", () => {
    for (let r = 1; r <= 8; r++) expect(season.fixtures.filter((f) => f.roundOrder === r)).toHaveLength(18);
    const opponents = new Map<number, Set<number>>();
    for (const f of season.fixtures.filter((f) => f.roundOrder <= 8)) {
      opponents.set(f.homeClubId, (opponents.get(f.homeClubId) ?? new Set()).add(f.awayClubId));
      opponents.set(f.awayClubId, (opponents.get(f.awayClubId) ?? new Set()).add(f.homeClubId));
    }
    for (const set of opponents.values()) expect(set.size).toBe(8);
  });

  it("mata-mata: 8+8 playoff, 8+8 oitavas, 4+4 quartas, 2+2 semi e final", () => {
    const count = (r: number) => season.fixtures.filter((f) => f.roundOrder === r).length;
    expect([9, 10, 11, 12, 13, 14, 15, 16, 17].map(count)).toEqual([8, 8, 8, 8, 4, 4, 2, 2, 1]);
  });

  it("placar bate com gols e gols contra da linha do tempo", () => {
    for (const f of season.fixtures) {
      const homeScorers = f.detail.players.filter((p) => p.clubId === f.homeClubId).reduce((s, p) => s + p.goals, 0);
      const awayOwnGoals = f.detail.goals.filter(
        (g) => g.concedingClubId === f.awayClubId && g.ownGoalPlayerId !== null,
      ).length;
      expect(f.detail.homeGoals).toBe(homeScorers + awayOwnGoals);
    }
  });

  it("é determinística", () => {
    expect(new MockSeason().fixtures[0]?.detail).toEqual(season.fixtures[0]?.detail);
  });
});

describe("MockProvider", () => {
  const anchor = new Date("2026-09-15T19:00:00Z");

  it("só revela placar e estatísticas de partidas encerradas", async () => {
    const provider = new MockProvider({ anchor, now: () => new Date("2026-09-17T12:00:00Z") });
    const fixtures = await provider.getFixtures();
    const round1 = fixtures.filter((f) => f.roundOrder === 1);
    expect(round1.every((f) => f.status === "FINISHED" && f.homeGoals !== null)).toBe(true);
    const round2 = fixtures.filter((f) => f.roundOrder === 2);
    expect(round2.every((f) => f.status === "SCHEDULED" && f.homeGoals === null)).toBe(true);
    expect(await provider.getMatchDetails(round2.map((f) => f.id))).toEqual([]);
    expect(await provider.getMatchDetails(round1.map((f) => f.id))).toHaveLength(18);
  });

  it("só informa a classificação da fase de liga depois da rodada 8", async () => {
    const early = new MockProvider({ anchor, now: () => new Date("2026-10-01T00:00:00Z") });
    expect((await early.getLeagueStageRanks()).size).toBe(0);
    const late = new MockProvider({ anchor, now: () => new Date("2027-01-01T00:00:00Z") });
    expect((await late.getLeagueStageRanks()).size).toBe(36);
  });
});
