import { and, asc, eq } from "drizzle-orm";
import { game } from "@config/game";
import type { Db } from "@/db/client";
import { clubs, fantasyTeams, matches, playerHistory, playerMatchStats, players, rosterSlots, rounds } from "@/db/schema";
import { aliveAfterPlayoff, byeRounds, roundAvailability, type RoundAvailability } from "@/domain/bye";
import { currentRound } from "@/domain/lock";
import { computePoints } from "@/domain/scoring";
import type { RawPlayerStats } from "@/domain/types";

/** Tudo o que a página do jogador mostra: rodadas da temporada, próximos jogos, byes e temporada anterior. */
export async function playerDetail(db: Db, leagueId: number, playerId: number) {
  const [row] = await db
    .select({ player: players, club: clubs })
    .from(players)
    .innerJoin(clubs, eq(clubs.id, players.clubId))
    .where(eq(players.id, playerId));
  if (!row) return null;
  const { player, club } = row;

  const [ownerRow, allRounds, allMatches, allClubs, stats, history] = await Promise.all([
    db
      .select({ teamId: fantasyTeams.id, teamName: fantasyTeams.name, userId: fantasyTeams.userId, slot: rosterSlots.slot })
      .from(rosterSlots)
      .innerJoin(fantasyTeams, eq(fantasyTeams.id, rosterSlots.teamId))
      .where(and(eq(rosterSlots.leagueId, leagueId), eq(rosterSlots.playerId, playerId))),
    db.select().from(rounds).orderBy(asc(rounds.order)),
    db.select().from(matches).orderBy(asc(matches.kickoff)),
    db.select().from(clubs),
    db.select().from(playerMatchStats).where(eq(playerMatchStats.playerId, playerId)),
    db.select().from(playerHistory).where(eq(playerHistory.playerId, playerId)).orderBy(asc(playerHistory.kickoff)),
  ]);
  const clubById = new Map(allClubs.map((c) => [c.id, c]));
  const matchesByRound = new Map<number, typeof allMatches>();
  for (const m of allMatches) matchesByRound.set(m.roundOrder, [...(matchesByRound.get(m.roundOrder) ?? []), m]);
  const current = currentRound(allRounds);
  const lastFantasyRound = game.season.playoffs[game.season.playoffs.length - 1]!.toRound;

  /** Linha por rodada da temporada: o jogo do clube (se houve) e os pontos do jogador. */
  const season = allRounds
    .filter((r) => r.order <= lastFantasyRound)
    .map((r) => {
      const roundMatches = matchesByRound.get(r.order) ?? [];
      const match = roundMatches.find((m) => m.homeClubId === club.id || m.awayClubId === club.id) ?? null;
      const availability: RoundAvailability = roundAvailability(
        r.order,
        club.id,
        roundMatches,
        club.eliminatedAfterRound,
        aliveAfterPlayoff(club.id, matchesByRound),
      );
      const stat = match ? stats.find((s) => s.matchId === match.id) ?? null : null;
      const home = match?.homeClubId === club.id;
      const opponent = match ? clubById.get(home ? match.awayClubId : match.homeClubId) ?? null : null;
      return { round: r, match, home, opponent, availability, stat };
    });

  const upcoming = season.filter((s) => s.match && s.match.status !== "FINISHED");
  const played = season.filter((s) => s.match?.status === "FINISHED" || (s.availability === "BYE" && s.round.closedAt));
  const byes = byeRounds(club.id, matchesByRound, club.eliminatedAfterRound, current?.order ?? 1, lastFantasyRound);

  const total = stats.reduce((sum, s) => sum + s.points, 0);
  const games = stats.filter((s) => s.minutes > 0).length;
  const previous = history.map((h) => {
    const score = computePoints(player.position, h.stats as unknown as RawPlayerStats);
    return { ...h, minutes: (h.stats as unknown as RawPlayerStats).minutes, points: score.points, breakdown: score.breakdown };
  });

  return {
    player,
    club,
    owner: ownerRow[0] ?? null,
    current,
    season,
    played,
    upcoming,
    byes,
    totals: { points: Math.round(total * 100) / 100, games, avg: games ? Math.round((total / games) * 10) / 10 : 0 },
    previous,
    previousSeasonYear: previous[0]?.seasonYear ?? null,
  };
}
