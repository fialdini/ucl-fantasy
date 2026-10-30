export interface RoundTiming {
  order: number;
  firstKickoff: Date | null;
  closedAt: Date | null;
}

/** Rodada vigente: a primeira ainda não fechada (é nela que a escalação vale). */
export function currentRound<T extends RoundTiming>(rounds: readonly T[]): T | null {
  return [...rounds].sort((a, b) => a.order - b.order).find((r) => r.closedAt === null) ?? null;
}

/** A escalação trava no horário de início do primeiro jogo da rodada e só destrava no fechamento. */
export function isRoundLocked(round: RoundTiming, now: Date): boolean {
  if (round.closedAt !== null) return false;
  return round.firstKickoff !== null && now.getTime() >= round.firstKickoff.getTime();
}

export type LockState =
  | { locked: false; round: RoundTiming | null }
  | { locked: true; round: RoundTiming; reason: string };

/** Trava de escalação e de movimentação de elenco (waiver/free agent) para a rodada vigente. */
export function lineupLockState(rounds: readonly RoundTiming[], now: Date): LockState {
  const round = currentRound(rounds);
  if (round && isRoundLocked(round, now)) {
    return { locked: true, round, reason: "Escalação travada: a rodada já começou" };
  }
  return { locked: false, round };
}
