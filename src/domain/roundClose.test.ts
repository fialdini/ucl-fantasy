import { describe, expect, it } from "vitest";
import {
  knockoutLosers,
  leagueStageEliminated,
  matchupsClosedBy,
  roundCloseReadiness,
  waiverWindowAfter,
  type KnockoutMatch,
} from "./roundClose";

const cfg = { closeDelayHours: 24, matchDurationMinutes: 150 };
const kickoff = new Date("2026-11-05T20:00:00Z");
const afterWindow = new Date(kickoff.getTime() + (150 * 60 + 24 * 3600) * 1000);

describe("roundCloseReadiness", () => {
  it("não fecha com partida em andamento ou adiada", () => {
    const r = roundCloseReadiness(
      [
        { id: 1, status: "FINISHED", kickoff },
        { id: 2, status: "POSTPONED", kickoff },
      ],
      afterWindow,
      cfg,
    );
    expect(r).toMatchObject({ ready: false, pendingMatchIds: [2] });
  });

  it("espera o prazo de correção da fonte após o último jogo", () => {
    const matches = [{ id: 1, status: "FINISHED" as const, kickoff }];
    expect(roundCloseReadiness(matches, new Date(afterWindow.getTime() - 1), cfg).ready).toBe(false);
    expect(roundCloseReadiness(matches, afterWindow, cfg).ready).toBe(true);
  });

  it("partidas canceladas não seguram o fechamento", () => {
    const r = roundCloseReadiness(
      [
        { id: 1, status: "FINISHED", kickoff },
        { id: 2, status: "CANCELLED", kickoff },
      ],
      afterWindow,
      cfg,
    );
    expect(r.ready).toBe(true);
  });

  it("rodada vazia não fecha", () => {
    expect(roundCloseReadiness([], afterWindow, cfg).ready).toBe(false);
  });
});

describe("knockoutLosers", () => {
  const leg = (h: number, a: number, hg: number, ag: number, day: number, pens?: [number, number]): KnockoutMatch => ({
    homeClubId: h,
    awayClubId: a,
    homeGoals: hg,
    awayGoals: ag,
    homePenalties: pens?.[0] ?? null,
    awayPenalties: pens?.[1] ?? null,
    kickoff: new Date(Date.UTC(2027, 1, day)),
  });

  it("elimina quem perde no agregado", () => {
    expect(knockoutLosers([leg(1, 2, 2, 0, 10), leg(2, 1, 1, 0, 17)]).losers).toEqual([2]);
  });

  it("empate no agregado é decidido nos pênaltis da volta", () => {
    expect(knockoutLosers([leg(1, 2, 1, 0, 10), leg(2, 1, 1, 0, 17, [4, 2])]).losers).toEqual([1]);
  });

  it("final em jogo único", () => {
    expect(knockoutLosers([leg(5, 6, 0, 1, 29)]).losers).toEqual([5]);
  });

  it("confronto sem placar fica indefinido", () => {
    const r = knockoutLosers([{ ...leg(1, 2, 0, 0, 10), homeGoals: null }]);
    expect(r).toEqual({ losers: [], undecided: ["1-2"] });
  });
});

describe("demais regras do fechamento", () => {
  it("fase de liga elimina do 25º ao 36º", () => {
    const ranks = new Map(Array.from({ length: 36 }, (_, i) => [100 + i, i + 1]));
    const eliminated = leagueStageEliminated(ranks);
    expect(eliminated).toHaveLength(12);
    expect(eliminated[0]).toBe(124);
  });

  it("abre waiver comum ou repescagem conforme a rodada", () => {
    const closedAt = new Date("2026-11-07T00:00:00Z");
    expect(waiverWindowAfter(4, closedAt)).toEqual({ processAt: new Date("2026-11-08T00:00:00Z"), mode: "ROLLING" });
    expect(waiverWindowAfter(8, closedAt).mode).toBe("REPECHAGE");
    expect(waiverWindowAfter(10, closedAt).mode).toBe("REPECHAGE");
  });

  it("finaliza só os confrontos que terminam na rodada", () => {
    const matchups = [
      { id: 1, fromRound: 10, toRound: 10 },
      { id: 2, fromRound: 11, toRound: 12 },
      { id: 3, fromRound: 9, toRound: 9 },
    ];
    expect(matchupsClosedBy(matchups, 10).map((m) => m.id)).toEqual([1]);
    expect(matchupsClosedBy(matchups, 11)).toEqual([]);
    expect(matchupsClosedBy(matchups, 12).map((m) => m.id)).toEqual([2]);
  });
});
