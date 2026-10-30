import type { Position } from "./types";

/**
 * Leitura automática de lesões a partir das súmulas — sem fonte médica, só sinais objetivos:
 *  - antes do jogo: quem jogou o último jogo e não está na relação publicada vira "dúvida";
 *  - depois do jogo: titular substituído no 1º tempo (ou goleiro substituído) sem cartão vermelho vira
 *    "dúvida" (possível lesão);
 *  - volta ao normal quando o jogador aparece numa relação ou joga.
 * Registro do comissário (MANUAL) nunca é alterado por aqui, e o automático é sempre só "dúvida".
 */

/** Minutos até os quais a saída de um titular de linha sugere lesão (a partir daí é decisão técnica). */
export const EARLY_EXIT_MINUTES = 45;

export interface LastAppearance {
  minutes: number;
  started: boolean;
  redCard: boolean;
}

export interface AvailabilityInput {
  position: Position;
  injured: boolean;
  source: "MANUAL" | "AUTO" | null;
  /** Participação no último jogo encerrado do clube (null = não foi relacionado / sem registro). */
  last: LastAppearance | null;
  /** Relação publicada do próximo jogo: IN = relacionado, OUT = fora, null = escalação ainda não saiu. */
  nextSquad: "IN" | "OUT" | null;
}

export type AvailabilityAction = { type: "FLAG"; note: string } | { type: "CLEAR" } | null;

export function inferAvailability(i: AvailabilityInput): AvailabilityAction {
  if (i.source === "MANUAL") return null;
  const flagged = i.injured && i.source === "AUTO";
  if (i.nextSquad === "IN") return flagged ? { type: "CLEAR" } : null;
  if (i.nextSquad === "OUT") {
    return i.last && i.last.minutes > 0 ? { type: "FLAG", note: "Fora da relação do próximo jogo" } : null;
  }
  const last = i.last;
  if (last && last.started && !last.redCard && last.minutes > 0) {
    const early = i.position === "GK" ? last.minutes < 90 : last.minutes <= EARLY_EXIT_MINUTES;
    if (early) return { type: "FLAG", note: `Saiu aos ${last.minutes} min do último jogo` };
  }
  // Jogou bastante no último jogo: o sinal antigo não vale mais.
  if (flagged && last && last.minutes >= 60) return { type: "CLEAR" };
  return null;
}
