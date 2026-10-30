import type { MatchDetail } from "@/domain/types";
import type { FootballDataProvider, ProviderClub, ProviderFixture, ProviderPlayer } from "./types";

const DAY = 86_400_000;
const LIVE_MS = 2 * 3_600_000;

export interface ReplayClock {
  /** Deslocamento somado a todas as datas da temporada histórica. null = calcular o padrão. */
  offsetMs: number | null;
  saveOffset: (offsetMs: number) => Promise<void>;
  now: () => Date;
}

/**
 * Rodada 1 encerrada há pelo menos 5 dias; as seguintes no ritmo real da temporada.
 * Deslocamento em dias inteiros: os jogos mantêm o horário real.
 */
export function defaultReplayOffset(fixtures: readonly ProviderFixture[], now: Date): number {
  const firstKickoff = Math.min(...fixtures.filter((f) => f.roundOrder === 1).map((f) => f.kickoff.getTime()));
  const target = now.getTime() - 5 * DAY;
  return Math.floor((target - firstKickoff) / DAY) * DAY;
}

/**
 * Reapresenta uma temporada já encerrada como se estivesse acontecendo agora.
 * Datas são deslocadas; partidas cujo horário deslocado ainda não chegou aparecem sem placar e
 * sem estatística. Dados históricos não mudam: nada é buscado de novo (`fresh` é ignorado).
 * Elencos = jogadores das súmulas já reveladas (custo zero de requisições extras).
 */
export class ReplayProvider implements FootballDataProvider {
  readonly name: string;
  private fixtures: Promise<ProviderFixture[]> | null = null;
  private offset: number | null;

  constructor(
    private readonly inner: FootballDataProvider,
    private readonly clock: ReplayClock,
  ) {
    this.name = `${inner.name} (replay)`;
    this.offset = clock.offsetMs;
  }

  requestCount(): number {
    return this.inner.requestCount();
  }

  getClubs(): Promise<ProviderClub[]> {
    return this.inner.getClubs();
  }

  private async realFixtures(): Promise<ProviderFixture[]> {
    this.fixtures ??= this.inner.getFixtures();
    const fixtures = await this.fixtures;
    if (this.offset === null) {
      this.offset = defaultReplayOffset(fixtures, this.clock.now());
      await this.clock.saveOffset(this.offset);
    }
    return fixtures;
  }

  private shifted(f: ProviderFixture): ProviderFixture {
    const kickoff = new Date(f.kickoff.getTime() + (this.offset ?? 0));
    const elapsed = this.clock.now().getTime() - kickoff.getTime();
    if (elapsed >= LIVE_MS) return { ...f, kickoff };
    const status = elapsed < 0 ? "SCHEDULED" : "LIVE";
    return { ...f, kickoff, status, homeGoals: null, awayGoals: null, homePenalties: null, awayPenalties: null };
  }

  async getFixtures(): Promise<ProviderFixture[]> {
    return (await this.realFixtures()).map((f) => this.shifted(f));
  }

  private async revealedFinishedIds(): Promise<Set<number>> {
    return new Set((await this.getFixtures()).filter((f) => f.status === "FINISHED").map((f) => f.id));
  }

  async getMatchDetails(matchIds: readonly number[], options?: { fresh?: boolean; cacheOnly?: boolean }): Promise<MatchDetail[]> {
    const revealed = await this.revealedFinishedIds();
    return this.inner.getMatchDetails(matchIds.filter((id) => revealed.has(id)), options);
  }

  async getSquad(clubId: number): Promise<ProviderPlayer[]> {
    const fixtures = (await this.getFixtures()).filter(
      (f) => f.status === "FINISHED" && (f.homeClubId === clubId || f.awayClubId === clubId),
    );
    const details = await this.inner.getMatchDetails(fixtures.map((f) => f.id));
    const players = new Map<number, ProviderPlayer>();
    // Em ordem cronológica: a súmula mais recente define o clube e a posição.
    const byKickoff = new Map(fixtures.map((f) => [f.id, f.kickoff.getTime()]));
    for (const d of details.sort((a, b) => (byKickoff.get(a.matchId) ?? 0) - (byKickoff.get(b.matchId) ?? 0))) {
      for (const p of d.players) {
        if (p.clubId !== clubId || !p.position) continue;
        players.set(p.playerId, { id: p.playerId, name: p.name, position: p.position, clubId, photoUrl: null, injured: false });
      }
    }
    return [...players.values()];
  }

  async getLeagueStageRanks(): Promise<Map<number, number>> {
    const fixtures = await this.getFixtures();
    const done = fixtures.filter((f) => f.roundOrder <= 8).every((f) => f.status === "FINISHED");
    return done ? this.inner.getLeagueStageRanks() : new Map();
  }
}
