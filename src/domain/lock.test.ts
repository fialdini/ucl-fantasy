import { describe, expect, it } from "vitest";
import { currentRound, isRoundLocked, lineupLockState, type RoundTiming } from "./lock";

const kickoff = new Date("2026-11-04T17:45:00Z");
const round = (order: number, firstKickoff: Date | null, closedAt: Date | null = null): RoundTiming => ({
  order,
  firstKickoff,
  closedAt,
});

describe("travamento de escalação", () => {
  it("fica aberta antes do primeiro jogo", () => {
    expect(isRoundLocked(round(4, kickoff), new Date(kickoff.getTime() - 1))).toBe(false);
  });

  it("trava exatamente no horário do primeiro jogo", () => {
    expect(isRoundLocked(round(4, kickoff), kickoff)).toBe(true);
  });

  it("continua travada depois dos jogos até o fechamento", () => {
    expect(isRoundLocked(round(4, kickoff), new Date("2026-11-07T00:00:00Z"))).toBe(true);
  });

  it("destrava quando a rodada é fechada", () => {
    expect(isRoundLocked(round(4, kickoff, new Date("2026-11-06T12:00:00Z")), new Date("2026-11-07T00:00:00Z"))).toBe(
      false,
    );
  });

  it("rodada sem horário definido não trava", () => {
    expect(isRoundLocked(round(9, null), new Date())).toBe(false);
  });

  it("a rodada vigente é a primeira não fechada", () => {
    const rounds = [round(2, kickoff), round(1, kickoff, kickoff), round(3, null)];
    expect(currentRound(rounds)?.order).toBe(2);
  });

  it("informa o estado de trava da rodada vigente", () => {
    const rounds = [round(1, new Date("2026-10-01T00:00:00Z"), new Date("2026-10-03T00:00:00Z")), round(2, kickoff)];
    expect(lineupLockState(rounds, new Date("2026-11-01T00:00:00Z")).locked).toBe(false);
    const state = lineupLockState(rounds, new Date("2026-11-04T18:00:00Z"));
    expect(state.locked).toBe(true);
    expect(state.round?.order).toBe(2);
  });
});
