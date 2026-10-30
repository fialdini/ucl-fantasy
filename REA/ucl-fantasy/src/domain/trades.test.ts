import { describe, expect, it } from "vitest";
import { game } from "@config/game";
import { cannotTrade, rostersAfterTrade, type TradePlayer } from "./trades";

const p = (playerId: number, position: TradePlayer["position"], clubId = playerId): TradePlayer => ({ playerId, position, clubId });
const rosters = () =>
  new Map<number, TradePlayer[]>([
    [1, [p(11, "GK"), p(12, "DEF"), p(13, "MID"), p(14, "FWD")]],
    [2, [p(21, "GK"), p(22, "DEF"), p(23, "MID"), p(24, "FWD")]],
  ]);
const trade = (items: Array<[number, number]>) => ({
  proposerTeamId: 1,
  receiverTeamId: 2,
  items: items.map(([playerId, fromTeamId]) => ({ playerId, fromTeamId })),
});
/** Elenco cheio do draft. */
const FULL: TradePlayer["position"][] = (["GK", "DEF", "MID", "FWD"] as const).flatMap((pos) => Array<typeof pos>(game.roster.starters[pos] + game.roster.bench[pos]).fill(pos));

describe("trocas", () => {
  it("1 por 1 e 2 por 1 (desigual) são válidas", () => {
    expect(cannotTrade(trade([[14, 1], [23, 2]]), rosters(), 3)).toBeNull();
    expect(cannotTrade(trade([[13, 1], [14, 1], [24, 2]]), rosters(), 3)).toBeNull();
    const after = rostersAfterTrade(trade([[13, 1], [14, 1], [24, 2]]), rosters());
    expect(after.get(1)!.map((x) => x.playerId).sort()).toEqual([11, 12, 24]);
    expect(after.get(2)!.map((x) => x.playerId).sort()).toEqual([13, 14, 21, 22, 23]);
  });

  it("pelo menos 1 jogador troca de mãos, no máximo 4 por lado; um lado pode ceder 0", () => {
    expect(cannotTrade(trade([]), rosters(), 3)).toMatch(/pelo menos 1/);
    // Troca "por nada": o outro time só recebe.
    expect(cannotTrade(trade([[14, 1]]), rosters(), 3)).toBeNull();
    const many = rosters();
    many.set(1, [...many.get(1)!, p(15, "MID"), p(16, "MID")]);
    expect(cannotTrade(trade([[12, 1], [13, 1], [14, 1], [15, 1], [16, 1], [24, 2]]), many, 3)).toMatch(/Máximo de 4/);
  });

  it("recusa jogador que não está com quem cede e o mesmo time dos dois lados", () => {
    expect(cannotTrade(trade([[24, 1], [23, 2]]), rosters(), 3, (id) => (id === 1 ? "Alfa" : "Beta"))).toMatch(/elenco de Alfa/);
    expect(cannotTrade({ ...trade([[14, 1]]), receiverTeamId: 1 }, rosters(), 3)).toMatch(/outro time/);
  });

  it("recusa quando um elenco resultante estoura tamanho ou limite por clube", () => {
    const full = rosters();
    full.set(2, FULL.map((position, i) => p(200 + i, position)));
    expect(cannotTrade(trade([[13, 1], [14, 1], [212, 2]]), full, 3, (id) => `T${id}`)).toMatch(new RegExp(`^T2: o elenco ficaria com ${game.roster.size + 1}`));

    const club = rosters();
    club.set(1, [p(11, "GK", 7), p(12, "DEF", 7), p(13, "MID", 7), p(14, "FWD")]);
    club.set(2, [p(21, "GK"), p(22, "DEF"), p(23, "MID", 7), p(24, "FWD")]);
    expect(cannotTrade(trade([[14, 1], [23, 2]]), club, 3)).toMatch(/mesmo clube/);
  });
});
