import { describe, expect, it } from "vitest";
import { cannotReplace, initialSlots, validateLineup } from "./roster";
import type { Position, RosterPlayer } from "./types";

function fullRoster(): RosterPlayer[] {
  const layout: Array<[Position, number, number]> = [
    ["GK", 1, 1],
    ["DEF", 4, 1],
    ["MID", 4, 1],
    ["FWD", 2, 1],
  ];
  const roster: RosterPlayer[] = [];
  let id = 1;
  for (const [position, starters, bench] of layout) {
    for (let i = 0; i < starters + bench; i++) {
      roster.push({ playerId: id, position, clubId: id, slot: i < starters ? "STARTER" : "BENCH" });
      id++;
    }
  }
  return roster;
}

describe("validateLineup", () => {
  it("aceita 1-4-4-2 com banco de 1 por posição", () => {
    expect(validateLineup(fullRoster())).toBeNull();
  });

  it("recusa formação diferente", () => {
    const roster = fullRoster().map((p) =>
      p.position === "DEF" && p.slot === "BENCH" ? { ...p, slot: "STARTER" as const } : p,
    );
    expect(validateLineup(roster)).toMatch(/Titulares: precisa de 4 DEF/);
  });

  it("recusa elenco incompleto", () => {
    expect(validateLineup(fullRoster().slice(1))).toMatch(/15 jogadores/);
  });
});

describe("cannotReplace", () => {
  const roster = fullRoster();

  it("permite troca na mesma posição", () => {
    expect(cannotReplace(roster, 15, { position: "FWD", clubId: 500 }, 3)).toBeNull();
  });

  it("recusa troca de posição diferente", () => {
    expect(cannotReplace(roster, 15, { position: "MID", clubId: 500 }, 3)).toMatch(/mesma posição/);
  });

  it("recusa dispensar quem não está no elenco", () => {
    expect(cannotReplace(roster, 999, { position: "FWD", clubId: 500 }, 3)).toMatch(/não está/);
  });

  it("respeita o limite por clube, desconsiderando o dispensado", () => {
    const sameClub = roster.map((p, i) => (i < 3 ? { ...p, clubId: 77 } : p));
    expect(cannotReplace(sameClub, 15, { position: "FWD", clubId: 77 }, 3)).toMatch(/mesmo clube/);
    expect(cannotReplace(sameClub, 1, { position: "GK", clubId: 77 }, 3)).toBeNull();
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
