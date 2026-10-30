import { scoring as defaultScoring, type ScoringConfig } from "@config/scoring";
import type { Position, RawPlayerStats } from "./types";

/**
 * Projeção de pontos para a próxima rodada.
 *
 * 1. Ritmo do jogador: cada scout por 90 min, somando esta temporada (peso 1) e a anterior (peso 0,5),
 *    puxado para a média da SUB-posição (lateral, volante…) quando há poucos minutos (PRIOR_MINUTES de "jogo
 *    médio"). Gols vêm de metade do ritmo próprio e metade de (chutes no gol × taxa de conversão encolhida),
 *    porque gol é muito mais ruidoso que volume de chute.
 * 2. Minutos esperados: probabilidade de ser titular (últimos 5 jogos, mais recentes pesam mais) × minutos
 *    de titular + o resto × minutos de reserva (lesionado = 0; dúvida = metade; sem jogo = 0).
 * 3. Força dos clubes: gols marcados/sofridos misturados com chutes no gol (menos sorte), ajustados pela
 *    qualidade dos adversários já enfrentados (iteração tipo Dixon–Coles) e puxados para a média com poucos jogos.
 * 4. Adversário e mando: scouts de ataque escalam com a fragilidade defensiva do adversário; gols
 *    sofridos esperados = média da competição × ataque do adversário × defesa do próprio time. A chance
 *    de jogo sem sofrer gol é a de Poisson: e^(−gols esperados).
 * 5. Pontos = scouts esperados × tabela de pontuação.
 */

export const PRIOR_MINUTES = 180;
const SHRINK_GAMES = 3;
const HOME_ATTACK = 1.08;
const AWAY_ATTACK = 0.93;
const RECENT_GAMES = 3;

export const SCOUTS = [
  "goals", "assists", "shotsOnTarget", "shotsWoodwork", "shotsOffTarget", "foulsSuffered", "penaltiesWon",
  "dribbles", "passesCompleted", "passesMissed", "offsides", "tackles", "ballsRecovered", "saves",
  "penaltiesSaved", "foulsCommitted", "penaltiesConceded", "yellowCards", "redCards", "ownGoals", "penaltiesMissed",
] as const;
export type Scout = (typeof SCOUTS)[number];
/** Scouts por 90 minutos. */
export type Rates = Record<Scout, number>;

const ATTACKING = new Set<Scout>(["goals", "assists", "shotsOnTarget", "shotsWoodwork", "shotsOffTarget", "foulsSuffered", "penaltiesWon", "dribbles", "offsides"]);
const DEFENSIVE = new Set<Scout>(["tackles", "ballsRecovered", "foulsCommitted", "yellowCards"]);

const zeroRates = (): Rates => Object.fromEntries(SCOUTS.map((s) => [s, 0])) as Rates;

// ---------- Força dos clubes ----------

export interface Strengths {
  /** Gols por time por jogo na competição. */
  avgGoals: number;
  /** >1 = ataque melhor que a média. */
  attack(clubId: number): number;
  /** >1 = defesa pior que a média (sofre mais). */
  defense(clubId: number): number;
}

export interface MatchResult {
  homeClubId: number;
  awayClubId: number;
  homeGoals: number | null;
  awayGoals: number | null;
  /** Chutes no gol de cada lado (opcional): entram como "gols esperados" para reduzir o peso da sorte. */
  homeShotsOnTarget?: number | null;
  awayShotsOnTarget?: number | null;
}

/** Quanto do "gol" de um time vem dos chutes no gol (o resto é o gol de verdade). */
const XG_WEIGHT = 0.5;
const RATING_ITERATIONS = 10;

/**
 * Ataque e defesa relativos de cada clube. Cada jogo vale como "gols" = mistura de gols reais e chutes no gol
 * (na escala de gols). As forças são resolvidas juntas, descontando o adversário: marcar 3 num time que
 * sofre muito vale menos do que marcar 3 num time que sofre pouco. Poucos jogos puxam para a média.
 */
export function teamStrengths(results: ReadonlyArray<MatchResult>): Strengths {
  type Row = { team: number; opp: number; gf: number; ga: number; home: boolean };
  const played = results.filter((m) => m.homeGoals !== null && m.awayGoals !== null);
  let goals = 0;
  let sot = 0;
  let sotSides = 0;
  for (const m of played) {
    goals += m.homeGoals! + m.awayGoals!;
    for (const v of [m.homeShotsOnTarget, m.awayShotsOnTarget]) if (v != null) { sot += v; sotSides++; }
  }
  const teamGames = played.length * 2;
  const avgGoals = teamGames ? goals / teamGames : 1.4;
  const sotScale = sotSides && sot > 0 ? avgGoals / (sot / sotSides) : 0;
  const mixed = (g: number, shots: number | null | undefined) => (shots != null && sotScale ? XG_WEIGHT * shots * sotScale + (1 - XG_WEIGHT) * g : g);

  const rows: Row[] = played.flatMap((m) => [
    { team: m.homeClubId, opp: m.awayClubId, gf: mixed(m.homeGoals!, m.homeShotsOnTarget), ga: mixed(m.awayGoals!, m.awayShotsOnTarget), home: true },
    { team: m.awayClubId, opp: m.homeClubId, gf: mixed(m.awayGoals!, m.awayShotsOnTarget), ga: mixed(m.homeGoals!, m.homeShotsOnTarget), home: false },
  ]);
  const byTeam = new Map<number, Row[]>();
  for (const r of rows) byTeam.set(r.team, [...(byTeam.get(r.team) ?? []), r]);

  const att = new Map<number, number>();
  const def = new Map<number, number>();
  for (const t of byTeam.keys()) { att.set(t, 1); def.set(t, 1); }
  const get = (m: Map<number, number>, t: number) => m.get(t) ?? 1;
  const mando = (home: boolean) => (home ? HOME_ATTACK : AWAY_ATTACK);
  for (let i = 0; i < RATING_ITERATIONS; i++) {
    const nextAtt = new Map<number, number>();
    const nextDef = new Map<number, number>();
    for (const [t, rs] of byTeam) {
      // Esperado de gols marcados com ataque 1 contra as defesas enfrentadas (e o inverso para a defesa).
      const forBase = rs.reduce((sum, r) => sum + avgGoals * get(def, r.opp) * mando(r.home), 0);
      const againstBase = rs.reduce((sum, r) => sum + avgGoals * get(att, r.opp) * mando(!r.home), 0);
      nextAtt.set(t, (rs.reduce((sum, r) => sum + r.gf, 0) + avgGoals * SHRINK_GAMES) / (forBase + avgGoals * SHRINK_GAMES));
      nextDef.set(t, (rs.reduce((sum, r) => sum + r.ga, 0) + avgGoals * SHRINK_GAMES) / (againstBase + avgGoals * SHRINK_GAMES));
    }
    for (const [t, v] of nextAtt) att.set(t, v);
    for (const [t, v] of nextDef) def.set(t, v);
  }
  return { avgGoals, attack: (c) => get(att, c), defense: (c) => get(def, c) };
}

// ---------- Ritmo dos jogadores ----------

export interface Appearance {
  stats: RawPlayerStats;
  /** 1 = esta temporada; 0,5 = temporada anterior. */
  weight: number;
}

/** Média por 90 min de cada grupo (jogos com 45+ min), usada como ponto de partida. */
export function groupPriors<K extends string>(rows: ReadonlyArray<{ key: K; stats: RawPlayerStats }>, keys: readonly K[]): Record<K, Rates> {
  const result = {} as Record<K, Rates>;
  for (const key of keys) {
    const sample = rows.filter((r) => r.key === key && r.stats.minutes >= 45);
    const minutes = sample.reduce((s, r) => s + r.stats.minutes, 0);
    const rates = zeroRates();
    for (const scout of SCOUTS) rates[scout] = minutes ? (sample.reduce((s, r) => s + r.stats[scout], 0) / minutes) * 90 : 0;
    result[key] = rates;
  }
  return result;
}

/** Média por 90 min de cada posição. */
export function positionPriors(rows: ReadonlyArray<{ position: Position; stats: RawPlayerStats }>): Record<Position, Rates> {
  return groupPriors(rows.map((r) => ({ key: r.position, stats: r.stats })), ["GK", "DEF", "MID", "FWD"] as const);
}

/** Chutes no gol de "jogo médio" para encolher a taxa de conversão do jogador. */
const CONVERSION_SHOTS = 8;

export function playerRates(appearances: readonly Appearance[], prior: Rates, priorMinutes = PRIOR_MINUTES): Rates {
  const minutes = appearances.reduce((s, a) => s + a.weight * a.stats.minutes, 0);
  const rates = zeroRates();
  for (const scout of SCOUTS) {
    const total = appearances.reduce((s, a) => s + a.weight * a.stats[scout], 0);
    rates[scout] = ((total + (prior[scout] / 90) * priorMinutes) / (minutes + priorMinutes)) * 90;
  }
  // Gols: metade do ritmo próprio, metade de (volume de chutes no gol × conversão encolhida para a média do grupo).
  if (rates.shotsOnTarget > 0 && prior.shotsOnTarget > 0) {
    const goalsTotal = appearances.reduce((s, a) => s + a.weight * a.stats.goals, 0);
    const shotsTotal = appearances.reduce((s, a) => s + a.weight * a.stats.shotsOnTarget, 0);
    const conversion = (goalsTotal + CONVERSION_SHOTS * (prior.goals / prior.shotsOnTarget)) / (shotsTotal + CONVERSION_SHOTS);
    rates.goals = 0.5 * rates.goals + 0.5 * rates.shotsOnTarget * conversion;
  }
  return rates;
}

export interface MinutesSample {
  minutes: number;
  started: boolean;
}

/** Pesos dos últimos 5 jogos, do mais recente para o mais antigo. */
const RECENT_WEIGHTS = [0.35, 0.25, 0.2, 0.12, 0.08];

/**
 * Minutos esperados: chance de ser titular (jogos recentes pesam mais) × minutos médios como titular
 * + o resto × minutos médios saindo do banco (que inclui os jogos em que nem entrou).
 * `samples` em ordem cronológica. Sem jogos, usa `fallback`.
 */
export function minutesModel(samples: readonly MinutesSample[], fallback: number): number {
  const recent = samples.slice(-RECENT_WEIGHTS.length).reverse();
  if (recent.length === 0) return fallback;
  const weights = recent.map((_, i) => RECENT_WEIGHTS[i]!);
  const total = weights.reduce((a, b) => a + b, 0);
  const pStart = recent.reduce((sum, r, i) => sum + (r.started ? weights[i]! : 0), 0) / total;
  const avg = (list: readonly MinutesSample[], def: number) => (list.length ? list.reduce((a, r) => a + r.minutes, 0) / list.length : def);
  const asStarter = avg(samples.filter((r) => r.started), 80);
  const asSub = avg(samples.filter((r) => !r.started), 15);
  return pStart * asStarter + (1 - pStart) * asSub;
}

/** Minutos esperados: média dos últimos jogos relacionados (inclui 0 de quem ficou no banco). */
export function expectedMinutes(recentMinutes: readonly number[], fallback: number): number {
  const last = recentMinutes.slice(-RECENT_GAMES);
  return last.length ? last.reduce((s, m) => s + m, 0) / last.length : fallback;
}

// ---------- Projeção ----------

export interface Fixture {
  clubId: number;
  opponentClubId: number;
  home: boolean;
}

export interface ProjectionInput {
  position: Position;
  rates: Rates;
  minutes: number;
  /** null = sem jogo na rodada (bye/eliminado). */
  fixture: Fixture | null;
  availability: "FIT" | "DOUBTFUL" | "INJURED";
}

export interface Projection {
  points: number;
  minutes: number;
  /** Probabilidade de jogo sem sofrer gol (time do jogador). */
  cleanSheet: number;
  /** Gols que o time do jogador deve sofrer. */
  goalsAgainst: number;
  lines: Array<{ label: string; points: number }>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function projectPlayer(input: ProjectionInput, strengths: Strengths, cfg: ScoringConfig = defaultScoring): Projection {
  const { position, fixture } = input;
  const availability = input.availability === "INJURED" ? 0 : input.availability === "DOUBTFUL" ? 0.5 : 1;
  const minutes = fixture ? Math.min(90, input.minutes) * availability : 0;
  if (!fixture || minutes <= 0) return { points: 0, minutes: 0, cleanSheet: 0, goalsAgainst: 0, lines: [] };

  const attackBoost = strengths.defense(fixture.opponentClubId) * (fixture.home ? HOME_ATTACK : AWAY_ATTACK);
  const pressure = strengths.attack(fixture.opponentClubId);
  const goalsAgainst = strengths.avgGoals * pressure * strengths.defense(fixture.clubId) * (fixture.home ? AWAY_ATTACK : HOME_ATTACK);
  const share = minutes / 90;

  const expected = zeroRates();
  for (const scout of SCOUTS) {
    let f = 1;
    if (ATTACKING.has(scout)) f = attackBoost;
    else if (DEFENSIVE.has(scout)) f = 1 + 0.5 * (pressure - 1);
    else if (scout === "saves") f = goalsAgainst / strengths.avgGoals;
    expected[scout] = input.rates[scout] * share * f;
  }

  const lines: Projection["lines"] = [];
  const add = (label: string, points: number) => {
    if (Math.abs(points) >= 0.05) lines.push({ label, points: round1(points) });
  };
  const per = (rule: { per: number; points: number }) => rule.points / rule.per;

  // Probabilidade de ficar 60+ min (para o SG): cresce de 0 (30 min esperados) a 1 (75 min).
  const p60 = Math.min(1, Math.max(0, (minutes - 30) / 45));
  const cleanSheet = Math.exp(-goalsAgainst);
  add("Tempo em campo", minutes >= cfg.appearance.fullMinutes ? cfg.appearance.full : cfg.appearance.partial);
  add("Gols", expected.goals * cfg.goal[position]);
  add("Assistências", expected.assists * cfg.assist);
  add("Finalizações defendidas", Math.max(expected.shotsOnTarget - expected.goals, 0) * cfg.shotSaved);
  add("Finalizações na trave", expected.shotsWoodwork * cfg.shotWoodwork);
  add("Finalizações para fora", expected.shotsOffTarget * cfg.shotOffTarget);
  add("Faltas sofridas", expected.foulsSuffered * cfg.foulSuffered);
  add("Pênaltis sofridos", expected.penaltiesWon * cfg.penaltyWon);
  add("Dribles", expected.dribbles * cfg.dribble);
  add("Passes certos", expected.passesCompleted * per(cfg.passesCompleted));
  if (cfg.passesMissed.positions.includes(position)) add("Passes incompletos", expected.passesMissed * per(cfg.passesMissed));
  add("Impedimentos", expected.offsides * cfg.offside);
  add("Desarmes", expected.tackles * cfg.tackle);
  add("Bolas recuperadas", expected.ballsRecovered * cfg.ballRecovered);
  if (cfg.cleanSheet.points[position] > 0) add(`Jogo sem sofrer gol (${Math.round(cleanSheet * 100)}%)`, cleanSheet * p60 * cfg.cleanSheet.points[position]);
  if (cfg.saves.positions.includes(position)) add("Defesas", expected.saves * per(cfg.saves));
  if (position === "GK") add("Pênaltis defendidos", expected.penaltiesSaved * cfg.penaltySaved);
  if (cfg.goalsConceded.positions.includes(position)) add("Gols sofridos", goalsAgainst * share * per(cfg.goalsConceded));
  add("Faltas cometidas", expected.foulsCommitted * per(cfg.foulsCommitted));
  add("Cartões", expected.yellowCards * cfg.yellowCard + expected.redCards * cfg.redCard);
  add("Pênaltis (perdido/cometido) e gol contra", expected.penaltiesMissed * cfg.penaltyMissed + expected.penaltiesConceded * cfg.penaltyConceded + expected.ownGoals * cfg.ownGoal);

  return { points: round1(lines.reduce((s, l) => s + l.points, 0)), minutes: Math.round(minutes), cleanSheet, goalsAgainst, lines };
}
