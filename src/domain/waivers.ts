import { cannotReplace } from "./roster";
import type { Position } from "./types";

export interface WaiverClaimInput {
  id: number;
  teamId: number;
  addPlayerId: number;
  dropPlayerId: number;
  /** Preferência dentro do próprio time (menor = mais desejado). */
  preference: number;
}

export interface WaiverPlayer {
  position: Position;
  clubId: number;
  active: boolean;
  clubEliminated: boolean;
}

export interface WaiverInput {
  /** Ordem de prioridade (inversa à classificação). */
  order: readonly number[];
  /**
   * ROLLING: quem é atendido vai para o fim da fila.
   * REPECHAGE (repescagem): ordem snake — no máximo 1 pedido atendido por time por volta,
   * e a volta seguinte inverte a ordem.
   */
  mode: "ROLLING" | "REPECHAGE";
  claims: readonly WaiverClaimInput[];
  rosters: ReadonlyMap<number, readonly number[]>;
  players: ReadonlyMap<number, WaiverPlayer>;
  clubCap: number;
}

export interface WaiverOutcome {
  claimId: number;
  status: "SUCCEEDED" | "FAILED";
  reason: string | null;
}

export interface WaiverMove {
  claimId: number;
  teamId: number;
  addPlayerId: number;
  dropPlayerId: number;
}

export function resolveWaivers(input: WaiverInput): {
  outcomes: WaiverOutcome[];
  /** Trocas atendidas, na ordem em que devem ser aplicadas. */
  moves: WaiverMove[];
  rosters: Map<number, number[]>;
} {
  const rosters = new Map([...input.rosters].map(([teamId, ids]) => [teamId, [...ids]]));
  const owned = new Set([...rosters.values()].flat());
  const pending = new Map<number, WaiverClaimInput[]>();
  for (const claim of [...input.claims].sort((a, b) => a.preference - b.preference || a.id - b.id)) {
    pending.set(claim.teamId, [...(pending.get(claim.teamId) ?? []), claim]);
  }
  const outcomes = new Map<number, WaiverOutcome>();
  const lastReason = new Map<number, string>();
  const moves: WaiverMove[] = [];

  const invalidReason = (claim: WaiverClaimInput): string | null => {
    const add = input.players.get(claim.addPlayerId);
    if (!add) return "Jogador desconhecido";
    if (owned.has(claim.addPlayerId)) return "Jogador já pertence a outro time";
    if (!add.active) return "Jogador fora da lista inscrita";
    if (add.clubEliminated) return "Clube do jogador foi eliminado";
    const roster = (rosters.get(claim.teamId) ?? []).flatMap((playerId) => {
      const p = input.players.get(playerId);
      return p ? [{ playerId, position: p.position, clubId: p.clubId }] : [];
    });
    return cannotReplace(roster, claim.dropPlayerId, add, input.clubCap);
  };

  /** Tenta atender o pedido mais desejado e válido do time; devolve true se atendeu. */
  const serve = (teamId: number): boolean => {
    const claims = pending.get(teamId) ?? [];
    while (claims.length > 0) {
      const claim = claims.shift()!;
      const reason = invalidReason(claim);
      if (reason) {
        outcomes.set(claim.id, { claimId: claim.id, status: "FAILED", reason });
        lastReason.set(claim.id, reason);
        continue;
      }
      const roster = rosters.get(claim.teamId)!;
      roster.splice(roster.indexOf(claim.dropPlayerId), 1, claim.addPlayerId);
      owned.delete(claim.dropPlayerId);
      owned.add(claim.addPlayerId);
      outcomes.set(claim.id, { claimId: claim.id, status: "SUCCEEDED", reason: null });
      moves.push({ claimId: claim.id, teamId: claim.teamId, addPlayerId: claim.addPlayerId, dropPlayerId: claim.dropPlayerId });
      return true;
    }
    return false;
  };

  if (input.mode === "ROLLING") {
    const queue = [...input.order];
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const teamId of queue) {
        if (serve(teamId)) {
          queue.splice(queue.indexOf(teamId), 1);
          queue.push(teamId);
          progressed = true;
          break;
        }
      }
    }
  } else {
    let pass = 0;
    let progressed = true;
    while (progressed) {
      progressed = false;
      const order = pass % 2 === 0 ? input.order : [...input.order].reverse();
      for (const teamId of order) if (serve(teamId)) progressed = true;
      pass++;
    }
  }

  for (const claim of input.claims) {
    if (!outcomes.has(claim.id)) {
      outcomes.set(claim.id, { claimId: claim.id, status: "FAILED", reason: lastReason.get(claim.id) ?? "Não atendido" });
    }
  }
  return { outcomes: input.claims.map((c) => outcomes.get(c.id)!), moves, rosters };
}
