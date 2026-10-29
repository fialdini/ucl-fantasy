import { describe, expect, it } from "vitest";
import { resolveWaivers, type WaiverInput, type WaiverPlayer } from "./waivers";

const fwd = (clubId: number, extra: Partial<WaiverPlayer> = {}): WaiverPlayer => ({
  position: "FWD",
  clubId,
  active: true,
  clubEliminated: false,
  ...extra,
});

// Time 1 tem o jogador 11, time 2 o 21, time 3 o 31. Livres: 100, 101, 102.
function setup(overrides: Partial<WaiverInput> = {}): WaiverInput {
  return {
    order: [1, 2, 3],
    mode: "ROLLING",
    claims: [],
    rosters: new Map([
      [1, [11]],
      [2, [21]],
      [3, [31]],
    ]),
    players: new Map([
      [11, fwd(1)],
      [21, fwd(2)],
      [31, fwd(3)],
      [100, fwd(10)],
      [101, fwd(11)],
      [102, fwd(12)],
      [103, { ...fwd(13), position: "MID" }],
    ]),
    clubCap: 3,
    ...overrides,
  };
}

const status = (r: ReturnType<typeof resolveWaivers>) => r.outcomes.map((o) => `${o.claimId}:${o.status}`);

describe("resolveWaivers", () => {
  it("quem tem prioridade leva o jogador disputado", () => {
    const r = resolveWaivers(
      setup({
        claims: [
          { id: 1, teamId: 2, addPlayerId: 100, dropPlayerId: 21, preference: 1 },
          { id: 2, teamId: 1, addPlayerId: 100, dropPlayerId: 11, preference: 1 },
        ],
      }),
    );
    expect(status(r)).toEqual(["1:FAILED", "2:SUCCEEDED"]);
    expect(r.outcomes[0]?.reason).toMatch(/outro time/);
    expect(r.rosters.get(1)).toEqual([100]);
    expect(r.rosters.get(2)).toEqual([21]);
  });

  it("ROLLING: quem é atendido vai para o fim da fila", () => {
    // Time 1 quer 100 e depois 101 (dropando o recém-chegado 100). Time 2 quer 101.
    const r = resolveWaivers(
      setup({
        claims: [
          { id: 1, teamId: 1, addPlayerId: 100, dropPlayerId: 11, preference: 1 },
          { id: 2, teamId: 1, addPlayerId: 101, dropPlayerId: 100, preference: 2 },
          { id: 3, teamId: 2, addPlayerId: 101, dropPlayerId: 21, preference: 1 },
        ],
      }),
    );
    expect(status(r)).toEqual(["1:SUCCEEDED", "2:FAILED", "3:SUCCEEDED"]);
    expect(r.moves.map((m) => m.claimId)).toEqual([1, 3]);
  });

  it("usa a preferência do time e segue para o próximo pedido se o primeiro falhar", () => {
    const r = resolveWaivers(
      setup({
        claims: [
          { id: 1, teamId: 1, addPlayerId: 100, dropPlayerId: 11, preference: 1 },
          { id: 2, teamId: 2, addPlayerId: 100, dropPlayerId: 21, preference: 1 },
          { id: 3, teamId: 2, addPlayerId: 102, dropPlayerId: 21, preference: 2 },
        ],
      }),
    );
    expect(status(r)).toEqual(["1:SUCCEEDED", "2:FAILED", "3:SUCCEEDED"]);
    expect(r.rosters.get(2)).toEqual([102]);
  });

  it("recusa troca de posição, jogador inativo e clube eliminado", () => {
    const players = new Map(setup().players);
    players.set(100, fwd(10, { active: false }));
    players.set(101, fwd(11, { clubEliminated: true }));
    const r = resolveWaivers(
      setup({
        players,
        claims: [
          { id: 1, teamId: 1, addPlayerId: 103, dropPlayerId: 11, preference: 1 },
          { id: 2, teamId: 2, addPlayerId: 100, dropPlayerId: 21, preference: 1 },
          { id: 3, teamId: 3, addPlayerId: 101, dropPlayerId: 31, preference: 1 },
        ],
      }),
    );
    expect(r.outcomes.map((o) => o.reason)).toEqual([
      "A troca precisa ser da mesma posição",
      "Jogador fora da lista inscrita",
      "Clube do jogador foi eliminado",
    ]);
  });

  it("REPECHAGE: snake — no máximo 1 por time por volta e a volta seguinte inverte", () => {
    // Time 1 (prioridade) quer 100 e 101; time 3 quer 101 e 102.
    // Volta 1 (1,2,3): t1 leva 100, t3 leva 101. Volta 2 (3,2,1): t3 leva 102; t1 perde 101.
    const r = resolveWaivers(
      setup({
        mode: "REPECHAGE",
        rosters: new Map([
          [1, [11, 12]],
          [2, [21]],
          [3, [31, 32]],
        ]),
        players: new Map([...setup().players, [12, fwd(1)], [32, fwd(3)]]),
        claims: [
          { id: 1, teamId: 1, addPlayerId: 100, dropPlayerId: 11, preference: 1 },
          { id: 2, teamId: 1, addPlayerId: 101, dropPlayerId: 12, preference: 2 },
          { id: 3, teamId: 3, addPlayerId: 101, dropPlayerId: 31, preference: 1 },
          { id: 4, teamId: 3, addPlayerId: 102, dropPlayerId: 32, preference: 2 },
        ],
      }),
    );
    expect(status(r)).toEqual(["1:SUCCEEDED", "2:FAILED", "3:SUCCEEDED", "4:SUCCEEDED"]);
    expect(r.moves.map((m) => m.claimId)).toEqual([1, 3, 4]);
  });
});
