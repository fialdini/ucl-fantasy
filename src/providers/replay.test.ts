import { describe, expect, it, vi } from "vitest";
import { MockProvider } from "./mock/provider";
import { defaultReplayOffset, ReplayProvider } from "./replay";

const DAY = 86_400_000;
// Temporada "histórica": rodada 1 em 15/09/2024. O mock inteiro já terminou nesta data.
const historicalAnchor = new Date("2024-09-15T19:00:00Z");
const longAfter = new Date("2026-01-01T00:00:00Z");
const inner = () => new MockProvider({ anchor: historicalAnchor, now: () => longAfter });

describe("ReplayProvider", () => {
  it("calcula o deslocamento padrão em dias inteiros: rodada 1 cinco dias atrás", async () => {
    const now = new Date("2026-10-29T12:00:00Z");
    const fixtures = await inner().getFixtures();
    const offset = defaultReplayOffset(fixtures, now);
    const first = Math.min(...fixtures.filter((f) => f.roundOrder === 1).map((f) => f.kickoff.getTime()));
    const shifted = first + offset;
    expect(shifted).toBeLessThanOrEqual(now.getTime() - 5 * DAY);
    expect(shifted).toBeGreaterThan(now.getTime() - 6 * DAY);
    expect(offset % DAY).toBe(0);
  });

  it("salva o deslocamento padrão e esconde o futuro", async () => {
    const now = new Date("2026-10-29T12:00:00Z");
    const saveOffset = vi.fn(async () => {});
    const replay = new ReplayProvider(inner(), { offsetMs: null, saveOffset, now: () => now });
    const fixtures = await replay.getFixtures();
    expect(saveOffset).toHaveBeenCalledTimes(1);
    const r1 = fixtures.filter((f) => f.roundOrder === 1);
    const r2 = fixtures.filter((f) => f.roundOrder === 2);
    expect(r1.every((f) => f.status === "FINISHED" && f.homeGoals !== null)).toBe(true);
    expect(r2.every((f) => f.status === "SCHEDULED" && f.homeGoals === null && f.kickoff > now)).toBe(true);
    expect(await replay.getMatchDetails(r2.map((f) => f.id))).toEqual([]);
    expect(await replay.getMatchDetails(r1.map((f) => f.id))).toHaveLength(18);
  });

  it("monta o elenco a partir das súmulas reveladas", async () => {
    const now = new Date("2026-10-29T12:00:00Z");
    const base = inner();
    // O mock não informa posição na súmula; simula uma fonte que informa.
    const withPositions = Object.assign(Object.create(base), {
      getMatchDetails: async (ids: readonly number[]) =>
        (await base.getMatchDetails(ids)).map((d) => ({ ...d, players: d.players.map((p) => ({ ...p, position: "MID" as const })) })),
    }) as MockProvider;
    const replay = new ReplayProvider(withPositions, { offsetMs: null, saveOffset: async () => {}, now: () => now });
    const clubId = (await replay.getFixtures()).find((f) => f.roundOrder === 1)!.homeClubId;
    const squad = await replay.getSquad(clubId);
    // 11 titulares + 3 que entraram na única partida revelada
    expect(squad).toHaveLength(14);
    expect(squad.every((p) => p.clubId === clubId && p.position === "MID")).toBe(true);
  });

  it("adiantar o relógio revela a rodada seguinte", async () => {
    const now = new Date("2026-10-29T12:00:00Z");
    const offset = defaultReplayOffset(await inner().getFixtures(), now);
    const replay = new ReplayProvider(inner(), { offsetMs: offset - 7 * DAY, saveOffset: async () => {}, now: () => now });
    const r2 = (await replay.getFixtures()).filter((f) => f.roundOrder === 2);
    expect(r2.every((f) => f.status === "FINISHED")).toBe(true);
  });

  it("só informa a classificação da fase de liga depois da rodada 8 revelada", async () => {
    const now = new Date("2026-10-29T12:00:00Z");
    const replay = new ReplayProvider(inner(), { offsetMs: null, saveOffset: async () => {}, now: () => now });
    expect((await replay.getLeagueStageRanks()).size).toBe(0);
  });
});
