import { z } from "zod";
import type { MatchDetail, MatchStatus, Position } from "@/domain/types";
import type { ProviderClub, ProviderFixture, ProviderPlayer } from "../types";

/** Converte respostas da API-Football v3 para o formato do jogo. Campos ausentes viram 0/null, nunca palpite. */

const num = z.number().nullable().optional();
const n0 = (v: number | null | undefined) => v ?? 0;

export const teamsSchema = z.array(
  z.object({ team: z.object({ id: z.number(), name: z.string(), code: z.string().nullable().optional(), logo: z.string().nullable().optional() }) }),
);

export const squadsSchema = z.array(
  z.object({
    team: z.object({ id: z.number() }),
    players: z.array(
      z.object({ id: z.number(), name: z.string(), position: z.string().nullable().optional(), photo: z.string().nullable().optional() }),
    ),
  }),
);

const fixtureCore = z.object({
  fixture: z.object({ id: z.number(), date: z.string(), status: z.object({ short: z.string() }) }),
  league: z.object({ round: z.string() }),
  teams: z.object({ home: z.object({ id: z.number() }), away: z.object({ id: z.number() }) }),
  goals: z.object({ home: num, away: num }),
  score: z.object({ penalty: z.object({ home: num, away: num }).optional() }).optional(),
});
export const fixturesSchema = z.array(fixtureCore);

export const fixtureDetailSchema = z.array(
  fixtureCore.extend({
    events: z
      .array(
        z.object({
          time: z.object({ elapsed: num, extra: num }),
          team: z.object({ id: z.number() }),
          player: z.object({ id: num }),
          type: z.string(),
          detail: z.string().nullable().optional(),
          comments: z.string().nullable().optional(),
        }),
      )
      .default([]),
    players: z
      .array(
        z.object({
          team: z.object({ id: z.number() }),
          players: z.array(
            z.object({
              player: z.object({ id: z.number(), name: z.string() }),
              statistics: z.array(
                z.object({
                  games: z.object({ minutes: num, substitute: z.boolean().nullable().optional(), position: z.string().nullable().optional() }),
                  goals: z.object({ total: num, assists: num, saves: num }).partial().optional(),
                  cards: z.object({ yellow: num, red: num }).partial().optional(),
                  penalty: z.object({ saved: num, missed: num }).partial().optional(),
                }),
              ),
            }),
          ),
        }),
      )
      .default([]),
  }),
);

export const standingsSchema = z.array(
  z.object({
    league: z.object({ standings: z.array(z.array(z.object({ rank: z.number(), team: z.object({ id: z.number() }) }))) }),
  }),
);

export function mapClubs(raw: unknown): ProviderClub[] {
  return teamsSchema.parse(raw).map(({ team }) => ({
    id: team.id,
    name: team.name,
    shortName: team.code ?? team.name.slice(0, 3).toUpperCase(),
    logoUrl: team.logo ?? null,
  }));
}

const POSITIONS: Record<string, Position> = { Goalkeeper: "GK", Defender: "DEF", Midfielder: "MID", Attacker: "FWD" };
const MATCH_POSITIONS: Record<string, Position> = { G: "GK", D: "DEF", M: "MID", F: "FWD" };

export function mapSquad(raw: unknown, clubId: number): ProviderPlayer[] {
  return squadsSchema.parse(raw).flatMap((entry) =>
    entry.players.flatMap((p) => {
      const position = p.position ? POSITIONS[p.position] : undefined;
      // Sem posição conhecida não dá para pontuar com segurança: fica fora.
      return position ? [{ id: p.id, name: p.name, position, clubId, photoUrl: p.photo ?? null, injured: false }] : [];
    }),
  );
}

export function mapStatus(short: string): MatchStatus {
  if (["NS", "TBD"].includes(short)) return "SCHEDULED";
  if (["FT", "AET", "PEN", "AWD", "WO"].includes(short)) return "FINISHED";
  if (short === "PST") return "POSTPONED";
  if (["CANC", "ABD"].includes(short)) return "CANCELLED";
  return "LIVE";
}

type Stage = "LEAGUE" | "PLAYOFF" | "R16" | "QF" | "SF" | "FINAL";

/** Nome da rodada na API → fase. Qualificatórias ("1st Qualifying Round", "Play-offs") ficam fora. */
export function mapRound(round: string): { stage: Stage; leagueRound?: number } | null {
  const league = /^League Stage - (\d+)$/i.exec(round);
  if (league) return { stage: "LEAGUE", leagueRound: Number(league[1]) };
  if (/^Knockout Round Play-offs$/i.test(round)) return { stage: "PLAYOFF" };
  if (/^Round of 16$/i.test(round)) return { stage: "R16" };
  if (/^Quarter-finals$/i.test(round)) return { stage: "QF" };
  if (/^Semi-finals$/i.test(round)) return { stage: "SF" };
  if (/^Final$/i.test(round)) return { stage: "FINAL" };
  return null;
}

const FIRST_LEG_ORDER: Record<Exclude<Stage, "LEAGUE" | "FINAL">, number> = { PLAYOFF: 9, R16: 11, QF: 13, SF: 15 };

/**
 * Lista de partidas. A API usa o mesmo nome para ida e volta; a perna é decidida pela data
 * dentro de cada confronto (mesmo par de clubes).
 */
export function mapFixtures(raw: unknown): ProviderFixture[] {
  const parsed = fixturesSchema.parse(raw);
  const result: ProviderFixture[] = [];
  const knockout = new Map<string, Array<{ f: (typeof parsed)[number]; stage: keyof typeof FIRST_LEG_ORDER }>>();
  const toFixture = (f: (typeof parsed)[number], roundOrder: number): ProviderFixture => ({
    id: f.fixture.id,
    roundOrder,
    homeClubId: f.teams.home.id,
    awayClubId: f.teams.away.id,
    kickoff: new Date(f.fixture.date),
    status: mapStatus(f.fixture.status.short),
    homeGoals: f.goals.home ?? null,
    awayGoals: f.goals.away ?? null,
    homePenalties: f.score?.penalty?.home ?? null,
    awayPenalties: f.score?.penalty?.away ?? null,
  });
  for (const f of parsed) {
    const round = mapRound(f.league.round);
    if (!round) continue;
    if (round.stage === "LEAGUE") {
      if (round.leagueRound && round.leagueRound <= 8) result.push(toFixture(f, round.leagueRound));
    } else if (round.stage === "FINAL") {
      result.push(toFixture(f, 17));
    } else {
      const key = `${round.stage}:${[f.teams.home.id, f.teams.away.id].sort((a, b) => a - b).join("-")}`;
      knockout.set(key, [...(knockout.get(key) ?? []), { f, stage: round.stage }]);
    }
  }
  for (const legs of knockout.values()) {
    legs
      .sort((a, b) => new Date(a.f.fixture.date).getTime() - new Date(b.f.fixture.date).getTime())
      .slice(0, 2)
      .forEach(({ f, stage }, i) => result.push(toFixture(f, FIRST_LEG_ORDER[stage] + i)));
  }
  return result;
}

/** Detalhe de partida (fixtures?ids=...) → MatchDetail. */
export function mapMatchDetails(raw: unknown): MatchDetail[] {
  return fixtureDetailSchema.parse(raw).map((f) => {
    const homeClubId = f.teams.home.id;
    const awayClubId = f.teams.away.id;
    const players: MatchDetail["players"] = f.players.flatMap((team) =>
      team.players.map(({ player, statistics }) => {
        const s = statistics[0];
        return {
          playerId: player.id,
          clubId: team.team.id,
          name: player.name,
          position: s?.games.position ? (MATCH_POSITIONS[s.games.position] ?? null) : null,
          minutes: n0(s?.games.minutes),
          substitute: s?.games.substitute ?? false,
          goals: n0(s?.goals?.total),
          assists: n0(s?.goals?.assists),
          yellowCards: n0(s?.cards?.yellow),
          redCards: n0(s?.cards?.red),
          saves: n0(s?.goals?.saves),
          penaltiesSaved: n0(s?.penalty?.saved),
          penaltiesMissed: n0(s?.penalty?.missed),
        };
      }),
    );
    const clubOf = new Map(players.map((p) => [p.playerId, p.clubId]));
    const other = (clubId: number) => (clubId === homeClubId ? awayClubId : homeClubId);
    const goals: MatchDetail["goals"] = f.events
      .filter((e) => e.type === "Goal" && e.detail !== "Missed Penalty" && e.comments !== "Penalty Shootout")
      .map((e) => {
        const minute = n0(e.time.elapsed) + n0(e.time.extra);
        if (e.detail === "Own Goal") {
          const scorer = e.player.id ?? null;
          // Quem faz gol contra sofre o gol pelo próprio clube.
          const concedingClubId = (scorer !== null ? clubOf.get(scorer) : undefined) ?? e.team.id;
          return { minute, concedingClubId, ownGoalPlayerId: scorer };
        }
        return { minute, concedingClubId: other(e.team.id), ownGoalPlayerId: null };
      });
    return {
      matchId: f.fixture.id,
      homeClubId,
      awayClubId,
      status: mapStatus(f.fixture.status.short),
      homeGoals: f.goals.home ?? null,
      awayGoals: f.goals.away ?? null,
      players,
      goals,
    };
  });
}

export function mapLeagueStageRanks(raw: unknown): Map<number, number> {
  const table = standingsSchema.parse(raw)[0]?.league.standings[0] ?? [];
  return new Map(table.map((row) => [row.team.id, row.rank]));
}
