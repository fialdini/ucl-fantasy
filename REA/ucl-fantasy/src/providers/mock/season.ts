import type { MatchDetail, PlayerScouts, Position } from "@/domain/types";
import type { ProviderClub, ProviderPlayer } from "../types";

/**
 * Temporada simulada e determinística (mesma semente → mesmos dados), só para desenvolvimento.
 * Resultados de todas as partidas são pré-calculados; o provider só os revela depois do apito final.
 */

const CLUBS: Array<[string, string]> = [
  ["Real Madrid", "RMA"], ["Barcelona", "BAR"], ["Atlético de Madrid", "ATM"], ["Athletic Club", "ATH"],
  ["Manchester City", "MCI"], ["Arsenal", "ARS"], ["Liverpool", "LIV"], ["Chelsea", "CHE"],
  ["Tottenham", "TOT"], ["Newcastle", "NEW"], ["Bayern München", "BAY"], ["Borussia Dortmund", "BVB"],
  ["Bayer Leverkusen", "B04"], ["Eintracht Frankfurt", "SGE"], ["RB Leipzig", "RBL"], ["Inter", "INT"],
  ["Milan", "MIL"], ["Juventus", "JUV"], ["Napoli", "NAP"], ["Atalanta", "ATA"],
  ["Paris Saint-Germain", "PSG"], ["Monaco", "MON"], ["Marseille", "OM"], ["Lille", "LIL"],
  ["Benfica", "BEN"], ["Porto", "POR"], ["Sporting CP", "SCP"], ["PSV", "PSV"],
  ["Feyenoord", "FEY"], ["Ajax", "AJA"], ["Club Brugge", "BRU"], ["Celtic", "CEL"],
  ["Galatasaray", "GAL"], ["Shakhtar Donetsk", "SHA"], ["Slavia Praha", "SLA"], ["Olympiacos", "OLY"],
];
const FIRST = ["Lucas", "Mateo", "Jonas", "Rafael", "Luca", "Noah", "Hugo", "Marco", "Tomás", "Kai", "Iván", "Leon", "Dani", "Enzo", "Milan", "Ola", "Pedro", "Theo", "Adam", "Bruno"];
const LAST = ["Silva", "Müller", "García", "Rossi", "Dubois", "Jansen", "Kovač", "Novak", "Costa", "Moreau", "Schmidt", "Fernández", "Bianchi", "Peeters", "Yilmaz", "Andersen", "Santos", "Lambert", "Ricci", "Kane"];
const SQUAD: Array<[Position, number]> = [["GK", 3], ["DEF", 8], ["MID", 8], ["FWD", 6]];

const BLANK: PlayerScouts = {
  goals: 0, assists: 0, shotsOnTarget: 0, shotsWoodwork: 0, shotsOffTarget: 0, tackles: 0, ballsRecovered: 0, dribbles: 0,
  passesCompleted: 0, passesMissed: 0, offsides: 0, foulsCommitted: 0, foulsSuffered: 0, penaltiesWon: 0, penaltiesConceded: 0,
  yellowCards: 0, redCards: 0, saves: 0, penaltiesSaved: 0, penaltiesMissed: 0,
};

/** Média por 90 min de cada scout de volume, por posição (passes = tentados; accuracy = % de acerto). */
interface Volume {
  shotsOn: number; shotsOff: number; woodwork: number; tackles: number; recoveries: number; dribbles: number;
  passes: number; accuracy: number; fouls: number; fouled: number; offsides: number; penWon: number; penConceded: number;
}
const VOLUME: Record<Position, Volume> = {
  GK: { shotsOn: 0, shotsOff: 0, woodwork: 0, tackles: 0.1, recoveries: 1.8, dribbles: 0, passes: 28, accuracy: 0.78, fouls: 0.05, fouled: 0.2, offsides: 0, penWon: 0, penConceded: 0.01 },
  DEF: { shotsOn: 0.3, shotsOff: 0.5, woodwork: 0.03, tackles: 2.2, recoveries: 4.2, dribbles: 0.4, passes: 55, accuracy: 0.88, fouls: 1.1, fouled: 0.8, offsides: 0.05, penWon: 0.01, penConceded: 0.04 },
  MID: { shotsOn: 0.7, shotsOff: 1.0, woodwork: 0.05, tackles: 1.8, recoveries: 3.8, dribbles: 1.2, passes: 50, accuracy: 0.86, fouls: 1.2, fouled: 1.4, offsides: 0.15, penWon: 0.03, penConceded: 0.02 },
  FWD: { shotsOn: 1.3, shotsOff: 1.5, woodwork: 0.08, tackles: 0.6, recoveries: 1.6, dribbles: 1.5, passes: 22, accuracy: 0.75, fouls: 1.0, fouled: 1.6, offsides: 0.8, penWon: 0.06, penConceded: 0.01 },
};

export const MOCK_CLUB_BASE = 1000;
export const clubIdAt = (index: number) => MOCK_CLUB_BASE + index + 1;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(random: () => number, lambda: number, cap: number): number {
  const l = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= random();
  } while (p > l);
  return Math.min(k - 1, cap);
}

function weightedPick<T>(random: () => number, items: readonly T[], weight: (item: T) => number): T | null {
  const total = items.reduce((s, i) => s + weight(i), 0);
  if (total <= 0) return null;
  let r = random() * total;
  for (const item of items) {
    r -= weight(item);
    if (r < 0) return item;
  }
  return items[items.length - 1] ?? null;
}

export interface MockFixture {
  id: number;
  roundOrder: number;
  /** 0 = primeiro dia da rodada (terça), 1 = segundo dia (quarta). */
  day: 0 | 1;
  homeClubId: number;
  awayClubId: number;
  detail: MatchDetail;
  homePenalties: number | null;
  awayPenalties: number | null;
}

export class MockSeason {
  readonly clubs: ProviderClub[];
  readonly squads = new Map<number, ProviderPlayer[]>();
  readonly fixtures: MockFixture[] = [];
  readonly leagueRanks = new Map<number, number>();

  constructor(readonly seed = 2026) {
    this.clubs = CLUBS.map(([name, shortName], i) => ({ id: clubIdAt(i), name, shortName, logoUrl: null }));
    const nameRandom = mulberry32(seed);
    for (const club of this.clubs) {
      let n = 1;
      const squad: ProviderPlayer[] = [];
      for (const [position, count] of SQUAD) {
        for (let i = 0; i < count; i++, n++) {
          const name = `${FIRST[Math.floor(nameRandom() * FIRST.length)]} ${LAST[Math.floor(nameRandom() * LAST.length)]}`;
          // Sub-posições alternadas para o mock ter variedade (como a súmula real tem).
          const subs = { GK: ["GK"], DEF: ["CB", "FB"], MID: ["AM", "DM"], FWD: ["ST", "WG"] } as const;
          const subPosition = subs[position][i % subs[position].length]!;
          squad.push({ id: club.id * 100 + n, name, position, subPosition, clubId: club.id, photoUrl: null, injured: false });
        }
      }
      this.squads.set(club.id, squad);
    }
    this.buildLeagueStage();
    this.buildKnockouts();
  }

  private buildLeagueStage() {
    // Método do círculo sobre 36 clubes: as 8 primeiras rodadas dão 8 adversários distintos por clube.
    const ids = this.clubs.map((c) => c.id);
    const table = new Map(ids.map((id) => [id, { pts: 0, gd: 0, gf: 0 }]));
    for (let r = 0; r < 8; r++) {
      const rotated = [ids[0]!, ...ids.slice(1).slice(35 - r), ...ids.slice(1).slice(0, 35 - r)];
      for (let i = 0; i < 18; i++) {
        const a = rotated[i]!;
        const b = rotated[35 - i]!;
        const [home, away] = (i + r) % 2 === 0 ? [a, b] : [b, a];
        const f = this.addFixture(r + 1, i, home, away);
        const h = f.detail.homeGoals!;
        const w = f.detail.awayGoals!;
        const th = table.get(home)!;
        const ta = table.get(away)!;
        th.gf += h;
        ta.gf += w;
        th.gd += h - w;
        ta.gd += w - h;
        if (h > w) th.pts += 3;
        else if (w > h) ta.pts += 3;
        else {
          th.pts++;
          ta.pts++;
        }
      }
    }
    [...table]
      .sort(([ia, a], [ib, b]) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || ia - ib)
      .forEach(([id], i) => this.leagueRanks.set(id, i + 1));
  }

  private buildKnockouts() {
    const byRank = [...this.leagueRanks].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    // Playoff: 9º×24º, 10º×23º, ... (volta na casa do mais bem colocado)
    const playoffTies = Array.from({ length: 8 }, (_, i) => [byRank[8 + i]!, byRank[23 - i]!] as const);
    const playoffWinners = this.twoLegTies(9, playoffTies);
    // Oitavas: 1º–8º contra os vencedores do playoff
    const r16 = Array.from({ length: 8 }, (_, i) => [byRank[i]!, playoffWinners[7 - i]!] as const);
    const qfClubs = this.twoLegTies(11, r16);
    const qf = Array.from({ length: 4 }, (_, i) => [qfClubs[2 * i]!, qfClubs[2 * i + 1]!] as const);
    const sfClubs = this.twoLegTies(13, qf);
    const sf = Array.from({ length: 2 }, (_, i) => [sfClubs[2 * i]!, sfClubs[2 * i + 1]!] as const);
    const finalists = this.twoLegTies(15, sf);
    const final = this.addFixture(17, 0, finalists[0]!, finalists[1]!);
    this.decideOnPenalties(final, final.detail.homeGoals!, final.detail.awayGoals!);
  }

  /** Cria ida (rodada `firstRound`) e volta; devolve os vencedores na ordem dos confrontos. */
  private twoLegTies(firstRound: number, ties: ReadonlyArray<readonly [number, number]>): number[] {
    return ties.map(([better, worse], i) => {
      const leg1 = this.addFixture(firstRound, i, worse, better);
      const leg2 = this.addFixture(firstRound + 1, i, better, worse);
      const aggBetter = leg1.detail.awayGoals! + leg2.detail.homeGoals!;
      const aggWorse = leg1.detail.homeGoals! + leg2.detail.awayGoals!;
      if (aggBetter !== aggWorse) return aggBetter > aggWorse ? better : worse;
      return this.decideOnPenalties(leg2, aggBetter, aggWorse);
    });
  }

  private decideOnPenalties(f: MockFixture, homeAgg: number, awayAgg: number): number {
    if (homeAgg !== awayAgg) return homeAgg > awayAgg ? f.homeClubId : f.awayClubId;
    const random = mulberry32(this.seed * 7 + f.id);
    const homeWins = random() < 0.5;
    f.homePenalties = homeWins ? 5 : 3;
    f.awayPenalties = homeWins ? 3 : 5;
    return homeWins ? f.homeClubId : f.awayClubId;
  }

  private addFixture(roundOrder: number, index: number, home: number, away: number): MockFixture {
    const id = roundOrder * 1000 + index + 1;
    const fixture: MockFixture = {
      id,
      roundOrder,
      day: roundOrder === 17 ? 0 : ((index % 2) as 0 | 1),
      homeClubId: home,
      awayClubId: away,
      detail: this.simulate(id, home, away),
      homePenalties: null,
      awayPenalties: null,
    };
    this.fixtures.push(fixture);
    return fixture;
  }

  private simulate(matchId: number, homeClubId: number, awayClubId: number): MatchDetail {
    const random = mulberry32(this.seed * 31 + matchId);
    type Line = MatchDetail["players"][number] & { position: Position; on: number; off: number };
    const lineupFor = (clubId: number): Line[] => {
      const squad = this.squads.get(clubId)!;
      const of = (p: Position) => squad.filter((s) => s.position === p);
      const pickN = (pool: ProviderPlayer[], n: number, window: number) =>
        pool.slice(0, window).sort(() => random() - 0.5).slice(0, n);
      const starters = [of("GK")[random() < 0.9 ? 0 : 1]!, ...pickN(of("DEF"), 4, 6), ...pickN(of("MID"), 4, 6), ...pickN(of("FWD"), 2, 4)];
      const lines: Line[] = starters.map((p) => ({
        playerId: p.id, clubId, name: p.name, position: p.position, minutes: 90, substitute: false, on: 0, off: 90, ...BLANK,
      }));
      for (const [position, minute] of [["FWD", 60], ["MID", 70], ["DEF", 80]] as const) {
        const outgoing = lines.filter((l) => l.position === position && !l.substitute)[0]!;
        const incoming = of(position).find((p) => !lines.some((l) => l.playerId === p.id));
        if (!incoming) continue;
        outgoing.minutes = minute;
        outgoing.off = minute;
        lines.push({
          playerId: incoming.id, clubId, name: incoming.name, position, minutes: 90 - minute, substitute: true, on: minute, off: 90, ...BLANK,
        });
      }
      return lines;
    };
    const home = lineupFor(homeClubId);
    const away = lineupFor(awayClubId);
    const goals: MatchDetail["goals"] = [];
    const onPitch = (lines: Line[], minute: number) => lines.filter((l) => l.on < minute && minute <= l.off);

    const score = (scoring: Line[], conceding: Line[], concedingClubId: number, lambda: number) => {
      const n = poisson(random, lambda, 5);
      for (let g = 0; g < n; g++) {
        const minute = random() < 0.1 ? 90 + 1 + Math.floor(random() * 5) : 1 + Math.floor(random() * 90);
        const slot = Math.min(minute, 90);
        if (random() < 0.05) {
          const og = weightedPick(random, onPitch(conceding, slot), (l) => (l.position === "DEF" ? 1 : 0));
          if (og) {
            goals.push({ minute, concedingClubId, ownGoalPlayerId: og.playerId });
            continue;
          }
        }
        const field = onPitch(scoring, slot);
        const scorer = weightedPick(random, field, (l) => ({ GK: 0, DEF: 1, MID: 3, FWD: 6 })[l.position]);
        if (!scorer) continue;
        scorer.goals++;
        if (random() < 0.75) {
          const assist = weightedPick(random, field, (l) => (l === scorer ? 0 : { GK: 0, DEF: 1, MID: 4, FWD: 2 }[l.position]));
          if (assist) assist.assists++;
        }
        goals.push({ minute, concedingClubId, ownGoalPlayerId: null });
      }
    };
    score(home, away, awayClubId, 1.5);
    score(away, home, homeClubId, 1.2);

    for (const [lines, opponent] of [[home, away], [away, home]] as const) {
      const gk = lines.find((l) => l.position === "GK")!;
      gk.saves = poisson(random, 3, 9);
      if (random() < 0.06) {
        const taker = weightedPick(random, lines, (l) => (l.position === "FWD" ? 3 : l.position === "MID" ? 1 : 0));
        if (taker) {
          taker.penaltiesMissed++;
          if (random() < 0.6) opponent.find((l) => l.position === "GK")!.penaltiesSaved++;
        }
      }
      for (const l of lines) {
        if (random() < 0.12) l.yellowCards = 1;
        if (random() < 0.012) l.redCards = 1;
      }
    }

    // Scouts de volume usam outro gerador para não alterar placares e cartões já sorteados.
    const volume = mulberry32(this.seed * 53 + matchId);
    for (const l of [...home, ...away]) {
      const v = VOLUME[l.position];
      const share = l.minutes / 90;
      const draw = (mean: number, cap: number) => poisson(volume, mean * share, cap);
      l.shotsOnTarget = l.goals + draw(v.shotsOn, 6);
      l.shotsOffTarget = draw(v.shotsOff, 6);
      l.shotsWoodwork = draw(v.woodwork, 2);
      l.tackles = draw(v.tackles, 8);
      l.ballsRecovered = draw(v.recoveries, 12);
      l.dribbles = draw(v.dribbles, 7);
      const total = Math.round(v.passes * share * (0.7 + volume() * 0.6));
      l.passesCompleted = Math.round(total * Math.min(v.accuracy + (volume() - 0.5) * 0.12, 1));
      l.passesMissed = total - l.passesCompleted;
      l.foulsCommitted = draw(v.fouls, 5);
      l.foulsSuffered = draw(v.fouled, 6);
      l.offsides = draw(v.offsides, 4);
      l.penaltiesWon = draw(v.penWon, 1);
      l.penaltiesConceded = draw(v.penConceded, 1);
    }

    const homeGoals = goals.filter((g) => g.concedingClubId === awayClubId).length;
    const awayGoals = goals.filter((g) => g.concedingClubId === homeClubId).length;
    return {
      matchId,
      homeClubId,
      awayClubId,
      status: "FINISHED",
      homeGoals,
      awayGoals,
      players: [...home, ...away].map(({ position: _p, on: _on, off: _off, ...rest }) => rest),
      goals: goals.sort((a, b) => a.minute - b.minute),
    };
  }
}
