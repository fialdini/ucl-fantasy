import { asc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { matches, playerHistory, playerMatchStats, players } from "@/db/schema";
import { injuryStatus } from "@/domain/injuries";
import {
  groupPriors,
  minutesModel,
  playerRates,
  positionPriors,
  projectPlayer,
  teamStrengths,
  type Appearance,
  type Projection,
} from "@/domain/projection";
import { SUB_POSITIONS, subOrDefault, type SubPosition } from "@/domain/subpositions";
import type { Position, RawPlayerStats } from "@/domain/types";

type StatRow = typeof playerMatchStats.$inferSelect;

const toRaw = (s: StatRow): RawPlayerStats => ({
  minutes: s.minutes,
  goals: s.goals,
  assists: s.assists,
  shotsOnTarget: s.shotsOnTarget,
  shotsWoodwork: s.shotsWoodwork,
  shotsOffTarget: s.shotsOffTarget,
  tackles: s.tackles,
  ballsRecovered: s.ballsRecovered,
  dribbles: s.dribbles,
  passesCompleted: s.passesCompleted,
  passesMissed: s.passesMissed,
  offsides: s.offsides,
  foulsCommitted: s.foulsCommitted,
  foulsSuffered: s.foulsSuffered,
  penaltiesWon: s.penaltiesWon,
  penaltiesConceded: s.penaltiesConceded,
  yellowCards: s.yellowCards,
  redCards: s.redCards,
  saves: s.saves,
  penaltiesSaved: s.penaltiesSaved,
  penaltiesMissed: s.penaltiesMissed,
  ownGoals: s.ownGoals,
  goalsConceded: s.goalsConceded,
});

export interface PlayerProjection extends Projection {
  opponentClubId: number | null;
  home: boolean;
}

/**
 * Projeções de uma rodada para todos os jogadores (uma consulta de cada tabela; barato o bastante
 * para rodar a cada página). Usa só partidas anteriores à rodada.
 */
export async function projectRound(db: DbOrTx, roundOrder: number, options: { ignoreAvailability?: boolean } = {}): Promise<Map<number, PlayerProjection>> {
  const [allMatches, stats, history, roster] = await Promise.all([
    db.select().from(matches).orderBy(asc(matches.kickoff)),
    db.select().from(playerMatchStats),
    db.select().from(playerHistory),
    db
      .select({ id: players.id, position: players.position, subPosition: players.subPosition, clubId: players.clubId, injured: players.injured, injuryReturn: players.injuryReturn })
      .from(players)
      .where(eq(players.active, true)),
  ]);
  const before = allMatches.filter((m) => m.roundOrder < roundOrder && m.status === "FINISHED");
  const pastStats = stats.filter((s) => s.roundOrder < roundOrder);
  // Chutes no gol de cada clube em cada partida (entram na força dos clubes como gols esperados).
  const shots = new Map<string, number>();
  for (const s of pastStats) shots.set(`${s.matchId}:${s.clubId}`, (shots.get(`${s.matchId}:${s.clubId}`) ?? 0) + s.shotsOnTarget);
  const strengths = teamStrengths(
    before.map((m) => ({ ...m, homeShotsOnTarget: shots.get(`${m.id}:${m.homeClubId}`) ?? null, awayShotsOnTarget: shots.get(`${m.id}:${m.awayClubId}`) ?? null })),
  );
  const subOf = new Map(roster.map((p) => [p.id, subOrDefault(p.position as Position, p.subPosition)]));
  const positionPrior = positionPriors(pastStats.map((s) => ({ position: s.position, stats: toRaw(s) })));
  const subPrior = groupPriors(
    pastStats.flatMap((s) => (subOf.has(s.playerId) ? [{ key: subOf.get(s.playerId)!, stats: toRaw(s) }] : [])),
    SUB_POSITIONS,
  );
  const subSamples = new Map<SubPosition, number>();
  for (const s of pastStats) {
    const sub = subOf.get(s.playerId);
    if (sub && s.minutes >= 45) subSamples.set(sub, (subSamples.get(sub) ?? 0) + 1);
  }
  // Sub-posição com poucos jogos de amostra cai na média da posição.
  const priorFor = (position: Position, sub: SubPosition) => ((subSamples.get(sub) ?? 0) >= 15 ? subPrior[sub] : positionPrior[position]);

  const kickoffOf = new Map(allMatches.map((m) => [m.id, m.kickoff.getTime()]));
  const byPlayer = new Map<number, StatRow[]>();
  for (const s of pastStats) byPlayer.set(s.playerId, [...(byPlayer.get(s.playerId) ?? []), s]);
  const historyByPlayer = new Map<number, typeof history>();
  for (const h of history) historyByPlayer.set(h.playerId, [...(historyByPlayer.get(h.playerId) ?? []), h]);

  const fixtureOf = new Map<number, { opponentClubId: number; home: boolean }>();
  for (const m of allMatches.filter((x) => x.roundOrder === roundOrder)) {
    fixtureOf.set(m.homeClubId, { opponentClubId: m.awayClubId, home: true });
    fixtureOf.set(m.awayClubId, { opponentClubId: m.homeClubId, home: false });
  }

  const result = new Map<number, PlayerProjection>();
  for (const p of roster) {
    const mine = (byPlayer.get(p.id) ?? []).sort((a, b) => (kickoffOf.get(a.matchId) ?? 0) - (kickoffOf.get(b.matchId) ?? 0));
    const past = historyByPlayer.get(p.id) ?? [];
    const appearances: Appearance[] = [
      ...mine.map((s) => ({ stats: toRaw(s), weight: 1 })),
      ...past.map((h) => ({ stats: h.stats as unknown as RawPlayerStats, weight: 0.5 })),
    ];
    // Sem jogos nesta temporada: minutos médios da anterior (quem só tem banco tende a pouco).
    const fallback = past.length ? past.reduce((s, h) => s + (h.stats as unknown as RawPlayerStats).minutes, 0) / past.length : 20;
    const fixture = fixtureOf.get(p.clubId);
    const projection = projectPlayer(
      {
        position: p.position as Position,
        rates: playerRates(appearances, priorFor(p.position as Position, subOf.get(p.id)!)),
        minutes: minutesModel(mine.map((s) => ({ minutes: s.minutes, started: s.started })), fallback),
        fixture: fixture ? { clubId: p.clubId, ...fixture } : null,
        availability: options.ignoreAvailability ? "FIT" : injuryStatus(p),
      },
      strengths,
    );
    result.set(p.id, { ...projection, opponentClubId: fixture?.opponentClubId ?? null, home: fixture?.home ?? false });
  }
  return result;
}
