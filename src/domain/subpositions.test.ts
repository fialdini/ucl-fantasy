import { describe, expect, it } from "vitest";
import { game } from "@config/game";
import { inferAvailability } from "./availability";
import { managerPoints } from "./manager";
import { cannotAdd, validateLineup } from "./roster";
import { classifyLineup, dominantSub, type SubPosition } from "./subpositions";
import type { Position } from "./types";

const p = (position: Position, subPosition: SubPosition, clubId = 1) => ({ position, subPosition, clubId });

describe("classificação de sub-posição", () => {
  it("usa a posição tática da UEFA quando combina com a posição", () => {
    expect(classifyLineup({ position: "DEF", detailed: "FULL_BACK" })).toBe("FB");
    expect(classifyLineup({ position: "MID", detailed: "DEFENSIVE_MIDFIELDER" })).toBe("DM");
    expect(classifyLineup({ position: "FWD", detailed: "STRIKER" })).toBe("ST");
  });
  it("sem posição tática, usa a coordenada do titular", () => {
    expect(classifyLineup({ position: "DEF", detailed: "UNKNOWN", x: 200, y: 250 })).toBe("FB");
    expect(classifyLineup({ position: "DEF", detailed: "UNKNOWN", x: 600, y: 250 })).toBe("CB");
    expect(classifyLineup({ position: "FWD", detailed: "UNKNOWN", x: 300, y: 800 }, 3)).toBe("WG");
    expect(classifyLineup({ position: "FWD", detailed: "UNKNOWN", x: 500, y: 800 }, 3)).toBe("ST");
    expect(classifyLineup({ position: "FWD", detailed: "UNKNOWN", x: 400, y: 800 }, 2)).toBe("ST");
    expect(classifyLineup({ position: "DEF", detailed: "UNKNOWN" })).toBeNull();
  });
  it("posição tática de outra linha cai na sub-posição mais próxima; o voto mais comum vence", () => {
    expect(classifyLineup({ position: "DEF", detailed: "WINGER" })).toBe("FB");
    expect(classifyLineup({ position: "MID", detailed: "WINGER" })).toBe("AM");
    expect(dominantSub("FWD", ["WG", null, "WG", "ST"])).toBe("WG");
    expect(dominantSub("DEF", [null])).toBe("CB");
  });
});

describe("sem mínimo por posição", () => {
  it("o draft só impõe teto por posição; elenco sem goleiro é válido e joga com menos", () => {
    expect(cannotAdd([], p("FWD", "ST", 40), 3)).toBeNull();
    const fwds = Array.from({ length: game.roster.maxPerPosition.FWD }, (_, i) => p("FWD", "ST", i));
    expect(cannotAdd(fwds, p("FWD", "WG", 99), 3)).toMatch(/FWD/);
    const roster = [{ playerId: 1, clubId: 1, position: "DEF" as const, slot: "STARTER" as const }, { playerId: 2, clubId: 2, position: "FWD" as const, slot: "BENCH" as const }];
    expect(validateLineup(roster)).toBeNull();
  });
});

describe("lesão automática", () => {
  const base = { position: "MID" as const, injured: false, source: null, last: { minutes: 90, started: true, redCard: false }, nextSquad: null };
  it("titular que sai no 1º tempo vira dúvida; saída tática não", () => {
    expect(inferAvailability({ ...base, last: { minutes: 31, started: true, redCard: false } })).toMatchObject({ type: "FLAG" });
    expect(inferAvailability({ ...base, last: { minutes: 70, started: true, redCard: false } })).toBeNull();
    expect(inferAvailability({ ...base, last: { minutes: 31, started: true, redCard: true } })).toBeNull();
    expect(inferAvailability({ ...base, last: { minutes: 20, started: false, redCard: false } })).toBeNull();
    expect(inferAvailability({ ...base, position: "GK", last: { minutes: 60, started: true, redCard: false } })).toMatchObject({ type: "FLAG" });
  });
  it("fora da relação marca; voltar à relação libera; registro do comissário é intocável", () => {
    expect(inferAvailability({ ...base, nextSquad: "OUT" })).toMatchObject({ type: "FLAG" });
    expect(inferAvailability({ ...base, injured: true, source: "AUTO", nextSquad: "IN" })).toEqual({ type: "CLEAR" });
    expect(inferAvailability({ ...base, injured: true, source: "MANUAL", nextSquad: "OUT" })).toBeNull();
    expect(inferAvailability({ ...base, injured: true, source: "AUTO" })).toEqual({ type: "CLEAR" });
  });
});

describe("técnico", () => {
  it("média do time + resultado + jogo sem sofrer gol", () => {
    expect(managerPoints({ goalsFor: 2, goalsAgainst: 0, playerPoints: [4, 6, 8] }).points).toBe(10);
    expect(managerPoints({ goalsFor: 0, goalsAgainst: 2, playerPoints: [-1, 1] }).points).toBe(-1);
    expect(managerPoints({ goalsFor: 1, goalsAgainst: 1, playerPoints: [] }).points).toBe(1);
  });
});
