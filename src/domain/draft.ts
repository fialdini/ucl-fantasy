import { game } from "@config/game";
import { cannotAdd } from "./roster";
import type { Position } from "./types";

/** Embaralhamento Fisher–Yates com gerador injetável (determinístico nos testes). */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** Ordem snake: rodada 1 na ordem sorteada, rodada 2 invertida, e assim por diante. */
export function snakeOrder(order: readonly number[], rounds: number = game.roster.size): number[] {
  const picks: number[] = [];
  for (let r = 0; r < rounds; r++) picks.push(...(r % 2 === 0 ? order : [...order].reverse()));
  return picks;
}

export function pickPosition(teamsCount: number, overall: number): { round: number; pickInRound: number } {
  return { round: Math.floor(overall / teamsCount) + 1, pickInRound: (overall % teamsCount) + 1 };
}

export interface DraftCandidate {
  playerId: number;
  position: Position;
  clubId: number;
}

/**
 * Valida o pick: jogador livre, posição com vaga e limite por clube. Como as cotas por posição
 * somam exatamente as 15 rodadas, respeitá-las garante que todo elenco termina completo.
 */
export function cannotPick(
  roster: readonly DraftCandidate[],
  player: DraftCandidate,
  takenPlayerIds: ReadonlySet<number>,
  clubCap: number,
): string | null {
  if (takenPlayerIds.has(player.playerId)) return "Jogador já escolhido";
  return cannotAdd(roster, player, clubCap);
}

/** Auto-pick: primeiro jogador do ranking que é um pick válido. */
export function autoPick(
  roster: readonly DraftCandidate[],
  rankedAvailable: readonly DraftCandidate[],
  takenPlayerIds: ReadonlySet<number>,
  clubCap: number,
): DraftCandidate | null {
  return rankedAvailable.find((p) => cannotPick(roster, p, takenPlayerIds, clubCap) === null) ?? null;
}
