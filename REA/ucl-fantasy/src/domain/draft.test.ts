import { describe, expect, it } from "vitest";
import { game } from "@config/game";
import { autoPick, cannotPick, pickPosition, shuffle, snakeOrder, type DraftCandidate } from "./draft";

describe("snakeOrder", () => {
  it("inverte a ordem a cada rodada", () => {
    expect(snakeOrder([1, 2, 3], 4)).toEqual([1, 2, 3, 3, 2, 1, 1, 2, 3, 3, 2, 1]);
  });

  it("gera uma rodada por vaga do elenco por padrão", () => {
    const picks = snakeOrder([7, 8, 9, 10, 11, 12]);
    expect(picks).toHaveLength(6 * game.roster.size);
    for (const team of [7, 8, 9, 10, 11, 12]) expect(picks.filter((t) => t === team)).toHaveLength(game.roster.size);
  });

  it("quem escolhe por último numa rodada escolhe primeiro na seguinte", () => {
    const picks = snakeOrder([1, 2, 3, 4, 5, 6], 2);
    expect(picks[5]).toBe(6);
    expect(picks[6]).toBe(6);
  });

  it("calcula rodada e posição do pick", () => {
    expect(pickPosition(6, 0)).toEqual({ round: 1, pickInRound: 1 });
    expect(pickPosition(6, 7)).toEqual({ round: 2, pickInRound: 2 });
  });
});

describe("shuffle", () => {
  it("mantém os mesmos elementos", () => {
    let seed = 42;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const result = shuffle([1, 2, 3, 4, 5, 6], random);
    expect([...result].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("validação de pick e auto-pick", () => {
  const gk = (id: number, clubId = id): DraftCandidate => ({ playerId: id, position: "GK", clubId });
  const fwd = (id: number, clubId = id): DraftCandidate => ({ playerId: id, position: "FWD", clubId });

  it("recusa jogador já escolhido", () => {
    expect(cannotPick([], gk(1), new Set([1]), 3)).toMatch(/já escolhido/);
  });

  it("recusa posição no teto (sem mínimo, só máximo)", () => {
    const full = Array.from({ length: game.roster.maxPerPosition.GK }, (_, i) => gk(i + 1));
    expect(cannotPick(full, gk(99), new Set(), 3)).toMatch(/GK/);
    expect(cannotPick([], gk(1), new Set(), 3)).toBeNull();
  });

  it("recusa o 4º jogador do mesmo clube", () => {
    const roster = [fwd(1, 99), fwd(2, 99), gk(3, 99)];
    expect(cannotPick(roster, { playerId: 4, position: "MID", clubId: 99 }, new Set(), 3)).toMatch(/mesmo clube/);
  });

  it("auto-pick escolhe o melhor do ranking que seja válido", () => {
    const roster = Array.from({ length: game.roster.maxPerPosition.GK }, (_, i) => gk(i + 1));
    const ranking = [gk(10), fwd(11), fwd(12)];
    expect(autoPick(roster, ranking, new Set([11]), 3)?.playerId).toBe(12);
  });

  it("auto-pick retorna null se não houver candidato válido", () => {
    const roster = Array.from({ length: game.roster.maxPerPosition.GK }, (_, i) => gk(i + 1));
    expect(autoPick(roster, [gk(99)], new Set(), 3)).toBeNull();
  });
});
