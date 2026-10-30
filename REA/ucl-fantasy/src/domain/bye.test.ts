import { describe, expect, it } from "vitest";
import { byeRounds, roundAvailability } from "./bye";
import { injuryFromForm, injuryLabel } from "./injuries";

const vs = (a: number, b: number) => ({ homeClubId: a, awayClubId: b });
const full = (n: number, start = 100) => Array.from({ length: n }, (_, i) => vs(start + 2 * i, start + 2 * i + 1));

describe("bye week", () => {
  it("joga, folga só com o chaveamento completo, a definir antes", () => {
    expect(roundAvailability(9, 100, full(8), null)).toBe("PLAYS");
    expect(roundAvailability(9, 1, full(8), null, true)).toBe("BYE");
    expect(roundAvailability(9, 1, full(3), null)).toBe("TBD");
    expect(roundAvailability(11, 1, full(8), 10)).toBe("ELIMINATED");
    // Fora de um mata-mata completo = eliminação (registrada ou por acontecer), nunca folga.
    expect(roundAvailability(11, 1, full(8), null, true)).toBe("TBD");
    // No playoff, folga só para quem segue vivo.
    expect(roundAvailability(9, 1, full(8), null, false)).toBe("TBD");
  });

  it("lista as rodadas de bye (top 8 pula o playoff)", () => {
    const rounds = new Map([
      [8, [vs(1, 2), ...full(17)]],
      [9, full(8)],
      [10, full(8)],
      [11, [vs(1, 100), ...full(7, 200)]],
    ]);
    // Clube 1 está nas oitavas: folga no playoff.
    expect(byeRounds(1, rounds, null, 8, 11)).toEqual([9, 10]);
    // Clube 2 fora do playoff e das oitavas: caiu na fase de liga, não é folga.
    expect(byeRounds(2, rounds, null, 8, 11)).toEqual([]);
    // Oitavas ainda não sorteadas: quem não foi eliminado folga no playoff.
    const beforeDraw = new Map([...rounds].filter(([r]) => r !== 11));
    expect(byeRounds(2, beforeDraw, null, 8, 11)).toEqual([9, 10]);
    expect(byeRounds(2, beforeDraw, 8, 8, 11)).toEqual([]);
  });
});

describe("lesões", () => {
  it("formulário do comissário e rótulos", () => {
    expect(injuryFromForm("INJURED", "2026-11-20")).toEqual({ injured: true, injuryReturn: "2026-11-20" });
    expect(injuryFromForm("INJURED", "")).toEqual({ injured: true, injuryReturn: null });
    expect(injuryFromForm("DOUBTFUL", "2026-11-20")).toEqual({ injured: true, injuryReturn: "DOUBTFUL" });
    expect(injuryFromForm("FIT", "2026-11-20")).toEqual({ injured: false, injuryReturn: null });
    const now = new Date("2026-10-29T12:00:00Z");
    expect(injuryLabel({ injured: true, injuryReturn: "2026-11-20" }, now)).toBe("Lesionado · volta 20/11");
    expect(injuryLabel({ injured: true, injuryReturn: "2027-02-01" }, now)).toBe("Lesionado · volta 01/02/2027");
    expect(injuryLabel({ injured: true, injuryReturn: "DOUBTFUL" }, now)).toBe("Dúvida");
    expect(injuryLabel({ injured: false, injuryReturn: null }, now)).toBeNull();
  });
});
