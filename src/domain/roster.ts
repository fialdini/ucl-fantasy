import { game } from "@config/game";
import type { SubPosition } from "./subpositions";
import type { Position, RosterPlayer, Slot } from "./types";

export const POSITIONS: readonly Position[] = ["GK", "DEF", "MID", "FWD"];

export type Formation = keyof typeof game.formations;
export const FORMATIONS = Object.keys(game.formations) as Formation[];
export const isFormation = (value: string): value is Formation => value in game.formations;
/** Titulares por posição da formação (valor desconhecido cai na formação padrão). */
export function formationSlots(formation: string = game.defaultFormation): Record<Position, number> {
  return isFormation(formation) ? game.formations[formation] : game.formations[game.defaultFormation as Formation];
}

/** Total de jogadores por posição no draft (titulares + banco): 2/6/7/4. */
export function positionQuota(position: Position): number {
  return game.roster.starters[position] + game.roster.bench[position];
}

export function countBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, number> {
  const counts = new Map<K, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

type Candidate = { position: Position; clubId: number; subPosition?: SubPosition | null };

/** Motivo pelo qual o jogador não pode entrar no elenco, ou null se pode. */
export function cannotAdd(
  roster: readonly Candidate[],
  player: Candidate,
  clubCap: number,
): string | null {
  const samePosition = roster.filter((p) => p.position === player.position).length;
  // Sem mínimo por posição: só o teto (o time joga com quem tiver).
  if (samePosition >= positionMax(player.position)) return `Elenco já tem ${samePosition} jogador(es) de ${player.position}`;
  const sameClub = roster.filter((p) => p.clubId === player.clubId).length;
  if (sameClub >= clubCap) return `Máximo de ${clubCap} jogadores do mesmo clube`;
  return null;
}

/** Máximo de jogadores por posição depois do draft. */
export function positionMax(position: Position): number {
  return game.roster.maxPerPosition[position];
}

/** Elenco depois do draft: até game.roster.size jogadores, máximo por posição e limite por clube. */
export function cannotHold(roster: readonly Candidate[], clubCap: number): string | null {
  if (roster.length > game.roster.size) return `O elenco ficaria com ${roster.length} jogadores (máximo ${game.roster.size})`;
  for (const position of POSITIONS) {
    const n = roster.filter((p) => p.position === position).length;
    if (n > positionMax(position)) return `O elenco ficaria com ${n} jogadores de ${position} (máximo ${positionMax(position)})`;
  }
  for (const n of countBy(roster, (p) => p.clubId).values()) {
    if (n > clubCap) return `O elenco ficaria com ${n} jogadores do mesmo clube (máximo ${clubCap})`;
  }
  return null;
}

/**
 * Movimento de mercado (waiver/free agent): entra `add` e, opcionalmente, sai `dropPlayerId`.
 * Sem dispensa, precisa haver vaga no elenco. Qualquer posição, desde que o elenco resultante seja válido.
 */
export function cannotReplace(
  roster: readonly (Candidate & { playerId: number })[],
  dropPlayerId: number | null,
  add: Candidate,
  clubCap: number,
): string | null {
  if (dropPlayerId !== null && !roster.some((p) => p.playerId === dropPlayerId)) return "Jogador a dispensar não está no elenco";
  const remaining = roster.filter((p) => p.playerId !== dropPlayerId);
  if (dropPlayerId === null && remaining.length >= game.roster.size) return `Elenco cheio (${game.roster.size}): escolha alguém para dispensar`;
  return cannotHold([...remaining, add], clubCap);
}

/** Titulares que a escalação precisa ter de cada posição: a formação, ou todos que o elenco tiver se faltar gente. */
export function requiredStarters(roster: readonly { position: Position }[], position: Position, formation?: string): number {
  return Math.min(formationSlots(formation)[position], roster.filter((p) => p.position === position).length);
}

/**
 * Valida a escalação: titulares conforme a formação escolhida e o resto no banco. Elenco com vaga em aberto
 * (após uma troca desigual) escala quem tiver; a posição incompleta joga com menos.
 */
export function validateLineup(roster: readonly RosterPlayer[], formation?: string): string | null {
  if (roster.length > game.roster.size) return `O elenco tem mais de ${game.roster.size} jogadores`;
  for (const position of POSITIONS) {
    const expected = requiredStarters(roster, position, formation);
    const actual = roster.filter((p) => p.position === position && p.slot === "STARTER").length;
    // Pode jogar com menos (decisão do técnico), nunca com mais do que a formação.
    if (actual > expected) return `Titulares: no máximo ${expected} ${position} nesta formação (tem ${actual})`;
  }
  return null;
}

/**
 * Ajusta titular/banco depois de uma mudança no elenco (troca, waiver, dispensa): mantém os titulares
 * que continuam, tira o excesso e completa a formação com o banco da mesma posição.
 * `preferred` (ex.: quem acabou de chegar) tem prioridade para ocupar a vaga de titular.
 */
export function normalizeSlots(
  roster: readonly { playerId: number; position: Position; slot: Slot }[],
  preferred: ReadonlySet<number> = new Set(),
  formation?: string,
): Map<number, Slot> {
  const slots = new Map<number, Slot>();
  for (const position of POSITIONS) {
    const group = roster.filter((p) => p.position === position);
    const ranked = [
      ...group.filter((p) => p.slot === "STARTER"),
      ...group.filter((p) => p.slot !== "STARTER" && preferred.has(p.playerId)),
      ...group.filter((p) => p.slot !== "STARTER" && !preferred.has(p.playerId)),
    ];
    const need = requiredStarters(roster, position, formation);
    ranked.forEach((p, i) => slots.set(p.playerId, i < need ? "STARTER" : "BENCH"));
  }
  return slots;
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
