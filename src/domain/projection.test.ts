import { describe, expect, it } from "vitest";
import { expectedMinutes, playerRates, positionPriors, projectPlayer, SCOUTS, teamStrengths, type Rates } from "./projection";
import type { RawPlayerStats } from "./types";

const zero = (): RawPlayerStats => ({
  minutes: 0, goals: 0, assists: 0, shotsOnTarget: 0, shotsWoodwork: 0, shotsOffTarget: 0, tackles: 0, ballsRecovered: 0,
  dribbles: 0, passesCompleted: 0, passesMissed: 0, offsides: 0, foulsCommitted: 0, foulsSuffered: 0, penaltiesWon: 0,
  penaltiesConceded: 0, yellowCards: 0, redCards: 0, saves: 0, penaltiesSaved: 0, penaltiesMissed: 0, ownGoals: 0, goalsConceded: 0,
});
const rates = (r: Partial<Rates>): Rates => ({ ...(Object.fromEntries(SCOUTS.map((s) => [s, 0])) as Rates), ...r });

// Clube 1 marca muito e não sofre; clube 2 sofre muito; clube 3 é médio.
const results = [
  { homeClubId: 1, awayClubId: 2, homeGoals: 4, awayGoals: 0 },
  { homeClubId: 3, awayClubId: 2, homeGoals: 3, awayGoals: 1 },
  { homeClubId: 1, awayClubId: 3, homeGoals: 2, awayGoals: 0 },
];
const strengths = teamStrengths(results);

describe("força dos clubes", () => {
  it("ataque e defesa relativos à média, puxados para 1 com poucos jogos", () => {
    expect(strengths.attack(1)).toBeGreaterThan(1);
    expect(strengths.defense(2)).toBeGreaterThan(1);
    expect(strengths.defense(1)).toBeLessThan(1);
    // Clube sem jogos = média.
    expect(strengths.attack(99)).toBe(1);
    expect(strengths.attack(1)).toBeLessThan(3);
  });
});

describe("projeção", () => {
  const forward = { position: "FWD" as const, rates: rates({ goals: 0.6, shotsOnTarget: 2, shotsOffTarget: 1.5 }), minutes: 90, availability: "FIT" as const };

  it("contra defesa frágil e em casa, o atacante projeta mais", () => {
    const easy = projectPlayer({ ...forward, fixture: { clubId: 3, opponentClubId: 2, home: true } }, strengths);
    const hard = projectPlayer({ ...forward, fixture: { clubId: 3, opponentClubId: 1, home: false } }, strengths);
    expect(easy.points).toBeGreaterThan(hard.points);
  });

  it("SG: maior chance contra ataque fraco, com e^(−gols esperados)", () => {
    const keeper = { position: "GK" as const, rates: rates({ saves: 3 }), minutes: 90, availability: "FIT" as const };
    const vsWeak = projectPlayer({ ...keeper, fixture: { clubId: 1, opponentClubId: 2, home: true } }, strengths);
    const vsStrong = projectPlayer({ ...keeper, fixture: { clubId: 2, opponentClubId: 1, home: false } }, strengths);
    expect(vsWeak.cleanSheet).toBeGreaterThan(vsStrong.cleanSheet);
    expect(vsWeak.cleanSheet).toBeCloseTo(Math.exp(-vsWeak.goalsAgainst), 6);
    expect(vsWeak.points).toBeGreaterThan(vsStrong.points);
  });

  it("lesionado, sem jogo ou sem minutos: zero; dúvida: metade dos minutos", () => {
    const fixture = { clubId: 3, opponentClubId: 2, home: true };
    expect(projectPlayer({ ...forward, fixture, availability: "INJURED" }, strengths).points).toBe(0);
    expect(projectPlayer({ ...forward, fixture: null }, strengths).points).toBe(0);
    expect(projectPlayer({ ...forward, fixture, availability: "DOUBTFUL" }, strengths).minutes).toBe(45);
  });
});

describe("ritmo e minutos", () => {
  it("poucos minutos ficam perto da média da posição", () => {
    const prior = rates({ goals: 0.3 });
    const hot = { ...zero(), minutes: 30, goals: 2 };
    expect(playerRates([{ stats: hot, weight: 1 }], prior).goals).toBeLessThan(2 * 3);
    expect(playerRates([{ stats: hot, weight: 1 }], prior).goals).toBeGreaterThan(0.3);
    expect(playerRates([], prior).goals).toBeCloseTo(0.3, 6);
  });

  it("média da posição e minutos recentes", () => {
    const priors = positionPriors([{ position: "FWD", stats: { ...zero(), minutes: 90, goals: 1 } }]);
    expect(priors.FWD.goals).toBeCloseTo(1, 6);
    expect(expectedMinutes([90, 90, 0, 60], 20)).toBe(50);
    expect(expectedMinutes([], 20)).toBe(20);
  });
});
