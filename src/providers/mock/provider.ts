import type { MatchDetail, MatchStatus } from "@/domain/types";
import type { FootballDataProvider, ProviderClub, ProviderFixture, ProviderPlayer } from "../types";
import { MockSeason, type MockFixture } from "./season";

const DAY = 86_400_000;

export interface MockClock {
  /** Início (terça 20:00) da rodada 1. As rodadas seguintes vêm a cada 7 dias. */
  anchor: Date;
  now: () => Date;
}

let cachedSeason: MockSeason | null = null;
const season = () => (cachedSeason ??= new MockSeason());

/**
 * Provider de desenvolvimento. O "relógio" (anchor) decide quais partidas já aconteceram:
 * partidas futuras aparecem sem placar e sem estatística, como numa API real.
 */
export class MockProvider implements FootballDataProvider {
  readonly name = "mock";

  constructor(private readonly clock: MockClock) {}

  kickoffOf(f: Pick<MockFixture, "roundOrder" | "day">): Date {
    return new Date(this.clock.anchor.getTime() + (f.roundOrder - 1) * 7 * DAY + f.day * DAY);
  }

  private statusOf(f: MockFixture): MatchStatus {
    const elapsed = this.clock.now().getTime() - this.kickoffOf(f).getTime();
    if (elapsed < 0) return "SCHEDULED";
    return elapsed < 2 * 3_600_000 ? "LIVE" : "FINISHED";
  }

  async getClubs(): Promise<ProviderClub[]> {
    return season().clubs;
  }

  async getSquad(clubId: number): Promise<ProviderPlayer[]> {
    return season().squads.get(clubId) ?? [];
  }

  async getFixtures(): Promise<ProviderFixture[]> {
    return season().fixtures.map((f) => {
      const status = this.statusOf(f);
      const done = status === "FINISHED";
      return {
        id: f.id,
        roundOrder: f.roundOrder,
        homeClubId: f.homeClubId,
        awayClubId: f.awayClubId,
        kickoff: this.kickoffOf(f),
        status,
        homeGoals: done ? f.detail.homeGoals : null,
        awayGoals: done ? f.detail.awayGoals : null,
        homePenalties: done ? f.homePenalties : null,
        awayPenalties: done ? f.awayPenalties : null,
      };
    });
  }

  async getMatchDetails(matchIds: readonly number[]): Promise<MatchDetail[]> {
    const wanted = new Set(matchIds);
    return season()
      .fixtures.filter((f) => wanted.has(f.id) && this.statusOf(f) === "FINISHED")
      .map((f) => f.detail);
  }

  async getLeagueStageRanks(): Promise<Map<number, number>> {
    const leagueStageDone = season()
      .fixtures.filter((f) => f.roundOrder <= 8)
      .every((f) => this.statusOf(f) === "FINISHED");
    return leagueStageDone ? new Map(season().leagueRanks) : new Map();
  }

  requestCount(): number {
    return 0;
  }
}
