import { game } from "@config/game";
import { cannotHold } from "./roster";
import type { SubPosition } from "./subpositions";
import type { Position } from "./types";

export interface TradePlayer {
  playerId: number;
  position: Position;
  subPosition?: SubPosition | null;
  clubId: number;
}

export interface TradeProposal {
  proposerTeamId: number;
  receiverTeamId: number;
  /** Cada jogador e o time que o cede. */
  items: ReadonlyArray<{ playerId: number; fromTeamId: number }>;
}

/** Elencos dos dois times depois da troca. */
export function rostersAfterTrade(
  proposal: TradeProposal,
  rosters: ReadonlyMap<number, readonly TradePlayer[]>,
): Map<number, TradePlayer[]> {
  const { proposerTeamId: a, receiverTeamId: b } = proposal;
  const moving = new Set(proposal.items.map((i) => i.playerId));
  const incoming = (to: number) =>
    proposal.items
      .filter((i) => i.fromTeamId !== to)
      .flatMap((i) => (rosters.get(i.fromTeamId) ?? []).filter((p) => p.playerId === i.playerId));
  const keep = (team: number) => (rosters.get(team) ?? []).filter((p) => !moving.has(p.playerId));
  return new Map([
    [a, [...keep(a), ...incoming(a)]],
    [b, [...keep(b), ...incoming(b)]],
  ]);
}

/**
 * Motivo pelo qual a troca não pode acontecer, ou null. Pelo menos 1 jogador troca de mãos, no máximo o
 * configurado por lado; um lado pode ceder 0 (troca "por nada": o outro time só recebe);
 * os jogadores precisam estar no elenco de quem os cede, e os dois elencos resultantes precisam ser
 * válidos (tamanho, máximo por posição e limite por clube). Trocas desiguais são permitidas: quem
 * recebe menos fica com vaga para pegar alguém nos waivers/free agency.
 */
export function cannotTrade(
  proposal: TradeProposal,
  rosters: ReadonlyMap<number, readonly TradePlayer[]>,
  clubCap: number,
  teamName: (teamId: number) => string = (id) => `Time ${id}`,
): string | null {
  const { proposerTeamId: a, receiverTeamId: b, items } = proposal;
  if (a === b) return "Escolha outro time para trocar";
  const ids = items.map((i) => i.playerId);
  if (new Set(ids).size !== ids.length) return "Jogador repetido na proposta";
  if (items.length === 0) return "A troca precisa ter pelo menos 1 jogador";
  for (const side of [a, b]) {
    const n = items.filter((i) => i.fromTeamId === side).length;
    if (n > game.trades.maxPlayersPerSide) return `Máximo de ${game.trades.maxPlayersPerSide} jogadores por lado`;
  }
  for (const item of items) {
    if (item.fromTeamId !== a && item.fromTeamId !== b) return "Jogador de um time fora da troca";
    if (!(rosters.get(item.fromTeamId) ?? []).some((p) => p.playerId === item.playerId)) {
      return `Um dos jogadores não está mais no elenco de ${teamName(item.fromTeamId)}`;
    }
  }
  for (const [teamId, roster] of rostersAfterTrade(proposal, rosters)) {
    const reason = cannotHold(roster, clubCap);
    if (reason) return `${teamName(teamId)}: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`;
  }
  return null;
}
