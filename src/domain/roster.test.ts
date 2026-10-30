import { describe, expect, it } from "vitest";
import { game } from "@config/game";
import { cannotReplace, initialSlots, normalizeSlots, validateLineup } from "./roster";
import type { RosterPlayer } from "./types";

const SIZE = game.roster.size;
const ids = (position: RosterPlayer["position"], slot: RosterPlayer["slot"]) =>
  fullRoster().filter((p) => p.position === position && p.slot === slot).map((p) => p.playerId);

/** Elenco completo do draft: 4-4-2 titular + banco da configuração (IDs 1…N em ordem de posição). */
function fullRoster(): RosterPlayer[] {
  const roster: RosterPlayer[] = [];
  let id = 1;
  for (const position of ["GK", "DEF", "MID", "FWD"] as const) {
    const starters = game.roster.starters[position];
    for (let i = 0; i < starters + game.roster.bench[position]; i++) {
      roster.push({ playerId: id, position, clubId: id, slot: i < starters ? "STARTER" : "BENCH" });
      id++;
    }
  }
  return roster;
}

describe("validateLineup", () => {
  it("aceita 1-4-4-2 com o banco completo", () => {
    expect(validateLineup(fullRoster())).toBeNull();
  });

  it("recusa formação diferente", () => {
    const roster = fullRoster().map((p) =>
      p.position === "DEF" && p.slot === "BENCH" ? { ...p, slot: "STARTER" as const } : p,
    );
    expect(validateLineup(roster)).toMatch(/Titulares: no máximo 4 DEF/);
  });

  it("elenco com vaga escala quem tiver na posição incompleta", () => {
    // Sem os dois goleiros: a escalação vale sem goleiro.
    const noGk = fullRoster().filter((p) => p.position !== "GK");
    expect(validateLineup(noGk)).toBeNull();
    // Com 1 goleiro no banco, o time pode jogar sem goleiro (decisão do técnico).
    const oneGk = fullRoster().filter((p) => p.playerId !== 1);
    expect(validateLineup(oneGk)).toBeNull();
  });

  it("recusa elenco acima do máximo", () => {
    const big = [...fullRoster(), { playerId: 99, position: "MID" as const, clubId: 99, slot: "BENCH" as const }];
    expect(validateLineup(big)).toMatch(new RegExp(`mais de ${SIZE}`));
  });
});

describe("cannotReplace", () => {
  const roster = fullRoster();
  const benchFwd = ids("FWD", "BENCH")[0]!;
  const benchGk = ids("GK", "BENCH")[0]!;

  it("permite troca na mesma posição", () => {
    expect(cannotReplace(roster, benchFwd, { position: "FWD", clubId: 500 }, 3)).toBeNull();
  });

  it("permite trocar por outra posição, respeitando o máximo por posição", () => {
    expect(cannotReplace(roster, benchFwd, { position: "MID", clubId: 500 }, 3)).toBeNull();
    // Troca o goleiro reserva por meias até o máximo de meias; o próximo meia estoura.
    const maxMid = game.roster.maxPerPosition.MID;
    const mids = roster.filter((p) => p.position === "MID").length;
    const extra = Array.from({ length: maxMid - mids }, (_, i) => ({ playerId: 90 + i, position: "MID" as const, clubId: 90 + i, slot: "BENCH" as const }));
    const atMax = [...roster.filter((p) => p.playerId !== benchFwd).slice(0, SIZE - extra.length - 1), ...extra];
    expect(cannotReplace(atMax, benchGk, { position: "MID", clubId: 500 }, 3)).toMatch(/máximo/);
  });

  it("sem dispensa: só com vaga no elenco", () => {
    expect(cannotReplace(roster, null, { position: "FWD", clubId: 500 }, 3)).toMatch(/Elenco cheio/);
    expect(cannotReplace(roster.slice(1), null, { position: "FWD", clubId: 500 }, 3)).toBeNull();
  });

  it("recusa dispensar quem não está no elenco", () => {
    expect(cannotReplace(roster, 999, { position: "FWD", clubId: 500 }, 3)).toMatch(/não está/);
  });

  it("respeita o limite por clube, desconsiderando o dispensado", () => {
    const sameClub = roster.map((p, i) => (i < 3 ? { ...p, clubId: 77 } : p));
    expect(cannotReplace(sameClub, benchFwd, { position: "FWD", clubId: 77 }, 3)).toMatch(/mesmo clube/);
    expect(cannotReplace(sameClub, 1, { position: "GK", clubId: 77 }, 3)).toBeNull();
  });
});

describe("normalizeSlots", () => {
  it("quem chega ocupa a vaga de titular aberta e o excesso vai para o banco", () => {
    // Saem um atacante titular e um meia reserva; chegam o atacante 50 e um meia marcado como titular (51).
    const outFwd = ids("FWD", "STARTER")[0]!;
    const outMid = ids("MID", "BENCH")[0]!;
    const keptBenchFwd = ids("FWD", "BENCH")[0]!;
    const roster = [
      ...fullRoster().filter((p) => p.playerId !== outFwd && p.playerId !== outMid),
      { playerId: 50, position: "FWD" as const, clubId: 50, slot: "BENCH" as const },
      { playerId: 51, position: "MID" as const, clubId: 51, slot: "STARTER" as const },
    ];
    const slots = normalizeSlots(roster, new Set([50, 51]));
    expect(slots.get(50)).toBe("STARTER");
    expect(slots.get(keptBenchFwd)).toBe("BENCH");
    const midStarters = roster.filter((p) => p.position === "MID" && slots.get(p.playerId) === "STARTER");
    expect(midStarters).toHaveLength(4);
    expect(validateLineup(roster.map((p) => ({ ...p, slot: slots.get(p.playerId)! })))).toBeNull();
  });
});

describe("initialSlots", () => {
  it("os primeiros escolhidos de cada posição viram titulares", () => {
    const slots = initialSlots([
      { playerId: 1, position: "GK" },
      { playerId: 2, position: "GK" },
      { playerId: 3, position: "FWD" },
    ]);
    expect(slots.get(1)).toBe("STARTER");
    expect(slots.get(2)).toBe("BENCH");
    expect(slots.get(3)).toBe("STARTER");
  });
});

describe("formações", () => {
  it("valida e reorganiza titulares conforme a formação escolhida", () => {
    const roster = fullRoster();
    // fullRoster está em 4-4-2; em 4-3-3 sobra 1 meia titular.
    expect(validateLineup(roster, "4-3-3")).toMatch(/no máximo 3 MID/);
    const slots = normalizeSlots(roster, new Set(), "4-3-3");
    const lineup = roster.map((p) => ({ ...p, slot: slots.get(p.playerId)! }));
    expect(validateLineup(lineup, "4-3-3")).toBeNull();
    expect(lineup.filter((p) => p.slot === "STARTER")).toHaveLength(11);
    expect(lineup.filter((p) => p.position === "FWD" && p.slot === "STARTER")).toHaveLength(3);
    // 5-3-2: 5 defensores titulares.
    const five = normalizeSlots(roster, new Set(), "5-3-2");
    expect(roster.filter((p) => p.position === "DEF" && five.get(p.playerId) === "STARTER")).toHaveLength(5);
  });
});
