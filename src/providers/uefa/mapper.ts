import { z } from "zod";
import { classifyLineup, type SubPosition } from "@/domain/subpositions";
import type { MatchDetail, MatchStatus, Position } from "@/domain/types";
import type { MatchdaySquad, ProviderClub, ProviderCoach, ProviderFixture, ProviderPlayer } from "../types";

/**
 * Converte as respostas dos endpoints públicos do site da UEFA (match.uefa.com, matchstats.uefa.com,
 * standings.uefa.com) para o formato do jogo. Campos ausentes viram 0/null, nunca palpite.
 * IDs chegam como texto e viram número (os IDs da UEFA cabem em integer).
 */

const id = z.union([z.string(), z.number()]).transform(Number);
const score = z.object({ home: z.number().nullable().optional(), away: z.number().nullable().optional() }).optional();

const team = z.object({
  id,
  internationalName: z.string(),
  teamCode: z.string().nullable().optional(),
  logoUrl: z.string().nullable().optional(),
  isPlaceHolder: z.boolean().optional(),
});

export const matchSchema = z.object({
  id,
  status: z.string(),
  kickOffTime: z.object({ dateTime: z.string() }),
  homeTeam: team,
  awayTeam: team,
  round: z.object({ phase: z.string(), metaData: z.object({ name: z.string() }).partial().optional() }),
  matchday: z.object({ sequenceNumber: z.string().optional() }).optional(),
  leg: z.object({ number: z.number() }).optional(),
  score: z.object({ total: score, penalty: score }).partial().optional(),
  playerEvents: z
    .object({
      scorers: z
        .array(
          z.object({
            goalType: z.string(),
            phase: z.string().optional(),
            teamId: id,
            player: z.object({ id }).optional(),
            time: z.object({ minute: z.number(), injuryMinute: z.number().optional() }).optional(),
          }),
        )
        .default([]),
    })
    .optional(),
});
export const matchesSchema = z.array(matchSchema);
export type UefaMatch = z.infer<typeof matchSchema>;

const lineupPlayer = z.object({
  player: z.object({
    id,
    internationalName: z.string(),
    fieldPosition: z.string().nullable().optional(),
    detailedFieldPosition: z.string().nullable().optional(),
    imageUrl: z.string().nullable().optional(),
    birthDate: z.string().nullable().optional(),
  }),
  fieldCoordinate: z.object({ x: z.number(), y: z.number() }).nullable().optional(),
});
const lineupCoach = z.object({
  imageUrl: z.string().nullable().optional(),
  role: z.string().optional(),
  person: z.object({ id, translations: z.object({ name: z.object({ EN: z.string().optional() }).partial().optional() }).partial().optional() }),
});
const lineupTeam = z.object({
  team: z.object({ id }),
  coaches: z.array(lineupCoach).default([]),
  field: z.array(lineupPlayer).default([]),
  bench: z.array(lineupPlayer).default([]),
});
export const lineupsSchema = z.object({ homeTeam: lineupTeam.optional(), awayTeam: lineupTeam.optional() });
export type UefaLineups = z.infer<typeof lineupsSchema>;

export const playerStatsSchema = z.array(
  z.object({
    playerId: id,
    statistics: z.array(z.object({ name: z.string(), value: z.union([z.string(), z.number()]).nullable() })),
  }),
);

export const standingsSchema = z.array(
  z.object({ items: z.array(z.object({ rank: z.number(), team: z.object({ id }) })) }),
);

const POSITIONS: Record<string, Position> = { GOALKEEPER: "GK", DEFENDER: "DEF", MIDFIELDER: "MID", FORWARD: "FWD" };

export function mapStatus(status: string): MatchStatus {
  if (status === "FINISHED") return "FINISHED";
  if (status === "LIVE") return "LIVE";
  if (status === "POSTPONED") return "POSTPONED";
  if (["CANCELLED", "ABANDONED"].includes(status)) return "CANCELLED";
  return "SCHEDULED";
}

/** Primeira perna de cada fase eliminatória na numeração de rodadas do jogo (a volta é +1). */
const KNOCKOUT_FIRST_LEG: Record<string, number> = {
  "Knock-out Play-off": 9,
  "Round of 16": 11,
  "Quarter-finals": 13,
  "Semi-finals": 15,
};

/** Rodada fantasy (1–17) da partida; null = fora do jogo (qualificatórias). */
export function roundOrderOf(m: UefaMatch): number | null {
  if (m.round.phase !== "TOURNAMENT") return null;
  const name = m.round.metaData?.name ?? "";
  if (/^League Phase$/i.test(name)) {
    const n = Number(m.matchday?.sequenceNumber);
    return n >= 1 && n <= 8 ? n : null;
  }
  if (/^Final$/i.test(name)) return 17;
  const first = KNOCKOUT_FIRST_LEG[name];
  if (first === undefined || !m.leg) return null;
  return first + (m.leg.number === 2 ? 1 : 0);
}

export function mapFixtures(raw: unknown): ProviderFixture[] {
  return matchesSchema.parse(raw).flatMap((m) => {
    const roundOrder = roundOrderOf(m);
    if (roundOrder === null || m.homeTeam.isPlaceHolder || m.awayTeam.isPlaceHolder) return [];
    const finished = mapStatus(m.status) !== "SCHEDULED";
    return [
      {
        id: m.id,
        roundOrder,
        homeClubId: m.homeTeam.id,
        awayClubId: m.awayTeam.id,
        kickoff: new Date(m.kickOffTime.dateTime),
        status: mapStatus(m.status),
        homeGoals: finished ? (m.score?.total?.home ?? null) : null,
        awayGoals: finished ? (m.score?.total?.away ?? null) : null,
        homePenalties: m.score?.penalty?.home ?? null,
        awayPenalties: m.score?.penalty?.away ?? null,
      },
    ];
  });
}

/** Clubes que disputam a fase principal (sem as qualificatórias). */
export function mapClubs(raw: unknown): ProviderClub[] {
  const clubs = new Map<number, ProviderClub>();
  for (const m of matchesSchema.parse(raw)) {
    if (roundOrderOf(m) === null) continue;
    for (const t of [m.homeTeam, m.awayTeam]) {
      if (t.isPlaceHolder) continue;
      clubs.set(t.id, {
        id: t.id,
        name: t.internationalName,
        shortName: t.teamCode ?? t.internationalName.slice(0, 3).toUpperCase(),
        logoUrl: t.logoUrl ?? null,
      });
    }
  }
  return [...clubs.values()];
}

/** Jogadores relacionados (titulares e reservas) de uma súmula. */
export function lineupPlayers(raw: unknown): ProviderPlayer[] {
  const lineups = lineupsSchema.parse(raw);
  return [lineups.homeTeam, lineups.awayTeam].flatMap((side) =>
    side
      ? [...side.field, ...side.bench].flatMap(({ player }) => {
          const position = player.fieldPosition ? POSITIONS[player.fieldPosition] : undefined;
          // Sem posição conhecida não dá para pontuar com segurança: fica fora.
          return position
            ? [
                {
                  id: player.id,
                  name: player.internationalName,
                  position,
                  clubId: side.team.id,
                  photoUrl: player.imageUrl ?? null,
                  injured: false,
                  birthDate: player.birthDate ?? null,
                },
              ]
            : [];
        })
      : [],
  );
}

/** Sub-posição de cada jogador relacionado nesta súmula (null = a súmula não permite deduzir). */
export function lineupSubs(raw: unknown): Array<{ playerId: number; sub: SubPosition | null }> {
  const lineups = lineupsSchema.parse(raw);
  return [lineups.homeTeam, lineups.awayTeam].flatMap((side) => {
    if (!side) return [];
    const front = side.field.filter((e) => e.player.fieldPosition === "FORWARD").length;
    const entry = (e: (typeof side.field)[number], starter: boolean) => {
      const position = e.player.fieldPosition ? POSITIONS[e.player.fieldPosition] : undefined;
      if (!position) return [];
      const sub = classifyLineup(
        { position, detailed: e.player.detailedFieldPosition, x: starter ? e.fieldCoordinate?.x : null, y: starter ? e.fieldCoordinate?.y : null },
        front,
      );
      return [{ playerId: e.player.id, sub }];
    };
    return [...side.field.flatMap((e) => entry(e, true)), ...side.bench.flatMap((e) => entry(e, false))];
  });
}

/** Técnicos das duas equipes da súmula (principal de cada clube). */
export function lineupCoaches(raw: unknown): ProviderCoach[] {
  const lineups = lineupsSchema.parse(raw);
  return [lineups.homeTeam, lineups.awayTeam].flatMap((side) => {
    const coach = side?.coaches[0];
    const name = coach?.person.translations?.name?.EN;
    return side && coach && name ? [{ id: coach.person.id, name, clubId: side.team.id, photoUrl: coach.imageUrl ?? null }] : [];
  });
}

/** Relacionados por clube quando a escalação já foi publicada (campo preenchido). */
export function lineupMatchdaySquad(matchId: number, raw: unknown): MatchdaySquad | null {
  const lineups = lineupsSchema.parse(raw);
  const clubs = new Map<number, Set<number>>();
  for (const side of [lineups.homeTeam, lineups.awayTeam]) {
    if (!side || side.field.length === 0) continue;
    clubs.set(side.team.id, new Set([...side.field, ...side.bench].map((e) => e.player.id)));
  }
  return clubs.size ? { matchId, clubs } : null;
}

/**
 * Linha do tempo de gols. Gol contra (OWN) vem com o time de quem marcou; os demais, com o time que
 * fez o gol. Acréscimos do 1º tempo ficam no minuto 45 (o reserva que entra no intervalo não sofre
 * esse gol); os do 2º tempo somam ao minuto e o cálculo de gols sofridos os leva ao fim da partida.
 * Disputa de pênaltis não aparece nos eventos de gol.
 */
export function mapGoals(match: UefaMatch): MatchDetail["goals"] {
  const other = (clubId: number) => (clubId === match.homeTeam.id ? match.awayTeam.id : match.homeTeam.id);
  return (match.playerEvents?.scorers ?? [])
    .filter((g) => g.phase !== "PENALTY_SHOOTOUT")
    .map((g) => {
      const minute = g.time ? (g.phase === "FIRST_HALF" ? Math.min(g.time.minute, 45) : g.time.minute + (g.time.injuryMinute ?? 0)) : 90;
      return g.goalType === "OWN"
        ? { minute, concedingClubId: g.teamId, ownGoalPlayerId: g.player?.id ?? null }
        : { minute, concedingClubId: other(g.teamId), ownGoalPlayerId: null };
    })
    .sort((a, b) => a.minute - b.minute);
}

/**
 * Partida → MatchDetail. Sem estatística por jogador (ainda não publicada), `players` volta vazio
 * e a partida fica "aguardando dados oficiais". Gols sofridos e gols contra saem da linha do tempo
 * (o `goals_conceded` da UEFA só vem preenchido para o goleiro).
 */
export function mapMatchDetail(match: UefaMatch, rawLineups: unknown, rawStats: unknown): MatchDetail {
  const lineups = lineupsSchema.parse(rawLineups);
  const stats = new Map(
    playerStatsSchema.parse(rawStats).map((p) => [p.playerId, new Map(p.statistics.map((s) => [s.name, Number(s.value) || 0]))]),
  );
  const players: MatchDetail["players"] = [];
  if (stats.size > 0) {
    for (const side of [lineups.homeTeam, lineups.awayTeam]) {
      if (!side) continue;
      for (const [entries, substitute] of [[side.field, false], [side.bench, true]] as const) {
        for (const { player } of entries) {
          const s = stats.get(player.id);
          // Relacionado sem linha de estatística (ex.: membro da comissão listado no banco) fica de fora.
          if (!s) continue;
          const v = (name: string) => s.get(name) ?? 0;
          const attempted = v("passes_attempted");
          const completed = Math.min(v("passes_completed"), attempted);
          const goals = v("goals");
          players.push({
            playerId: player.id,
            clubId: side.team.id,
            name: player.internationalName,
            position: player.fieldPosition ? (POSITIONS[player.fieldPosition] ?? null) : null,
            minutes: v("minutes_played_official"),
            substitute,
            goals,
            assists: v("assists"),
            // O chute no gol da UEFA inclui os gols, como na API-Football.
            shotsOnTarget: Math.max(v("attempts_on_target"), goals),
            shotsWoodwork: v("woodwork"),
            shotsOffTarget: v("attempts_off_target") + v("attempts_blocked"),
            tackles: v("tackles_won"),
            ballsRecovered: v("recovered_ball"),
            dribbles: v("dribbling_successful"),
            passesCompleted: completed,
            passesMissed: attempted - completed,
            offsides: v("offsides"),
            foulsCommitted: v("fouls_committed"),
            foulsSuffered: v("fouls_suffered"),
            penaltiesWon: v("penalty_awarded"),
            penaltiesConceded: v("penalty_conceded"),
            yellowCards: v("yellow_cards"),
            redCards: v("red_cards"),
            saves: v("saves"),
            penaltiesSaved: v("saves_on_penalty"),
            penaltiesMissed: v("penalty_miss"),
          });
        }
      }
    }
  }
  const finished = mapStatus(match.status) !== "SCHEDULED";
  return {
    matchId: match.id,
    homeClubId: match.homeTeam.id,
    awayClubId: match.awayTeam.id,
    status: mapStatus(match.status),
    homeGoals: finished ? (match.score?.total?.home ?? null) : null,
    awayGoals: finished ? (match.score?.total?.away ?? null) : null,
    players,
    goals: mapGoals(match),
  };
}

export function mapLeagueStageRanks(raw: unknown): Map<number, number> {
  const items = standingsSchema.parse(raw)[0]?.items ?? [];
  return new Map(items.map((row) => [row.team.id, row.rank]));
}
