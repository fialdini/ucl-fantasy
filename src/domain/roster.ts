import { game } from "@config/game";
import type { Position, RosterPlayer, Slot } from "./types";

export const POSITIONS: readonly Position[] = ["GK", "DEF", "MID", "FWD"];

/** Total de jogadores por posição no elenco (titulares + banco): 2/5/5/3. */
export function positionQuota(position: Position): number {
  return game.roster.starters[position] + game.roster.bench[position];
}

export function countBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, number> {
  const counts = new Map<K, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

type Candidate = { position: Position; clubId: number };

/** Motivo pelo qual o jogador não pode entrar no elenco, ou null se pode. */
export function cannotAdd(
  roster: readonly Candidate[],
  player: Candidate,
  clubCap: number,
): string | null {
  const samePosition = roster.filter((p) => p.position === player.position).length;
  if (samePosition >= positionQuota(player.position)) return `Elenco já tem ${samePosition} jogador(es) de ${player.position}`;
  const sameClub = roster.filter((p) => p.clubId === player.clubId).length;
  if (sameClub >= clubCap) return `Máximo de ${clubCap} jogadores do mesmo clube`;
  return null;
}

/** Troca (waiver/free agent): mesma posição, respeitando o limite por clube. */
export function cannotReplace(
  roster: readonly (Candidate & { playerId: number })[],
  dropPlayerId: number,
  add: Candidate,
  clubCap: number,
): string | null {
  const dropped = roster.find((p) => p.playerId === dropPlayerId);
  if (!dropped) return "Jogador a dispensar não está no elenco";
  if (dropped.position !== add.position) return "A troca precisa ser da mesma posição";
  return cannotAdd(
    roster.filter((p) => p.playerId !== dropPlayerId),
    add,
    clubCap,
  );
}

/** Valida a escalação: formação fixa 1-4-4-2 + banco com 1 de cada posição. */
export function validateLineup(roster: readonly RosterPlayer[]): string | null {
  if (roster.length !== game.roster.size) return `O elenco precisa ter ${game.roster.size} jogadores`;
  for (const position of POSITIONS) {
    for (const slot of ["STARTER", "BENCH"] as const) {
      const expected = slot === "STARTER" ? game.roster.starters[position] : game.roster.bench[position];
      const actual = roster.filter((p) => p.position === position && p.slot === slot).length;
      if (actual !== expected) {
        return `${slot === "STARTER" ? "Titulares" : "Banco"}: precisa de ${expected} ${position} (tem ${actual})`;
      }
    }
  }
  return null;
}

/** Distribui titulares/banco após o draft: os primeiros escolhidos de cada posição começam jogando. */
export function initialSlots(picksInOrder: readonly { playerId: number; position: Position }[]): Map<number, Slot> {
  const used = new Map<Position, number>();
  const slots = new Map<number, Slot>();
  for (const p of picksInOrder) {
    const n = used.get(p.position) ?? 0;
    slots.set(p.playerId, n < game.roster.starters[p.position] ? "STARTER" : "BENCH");
    used.set(p.position, n + 1);
  }
  return slots;
}
