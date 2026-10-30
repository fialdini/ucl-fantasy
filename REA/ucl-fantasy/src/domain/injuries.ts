/**
 * Situação física do jogador. O comissário registra (ou uma fonte de lesões, quando houver):
 * `injured` + `injuryReturn`, que é "DOUBTFUL" (dúvida), uma data AAAA-MM-DD (volta prevista) ou null.
 */

export type InjuryStatus = "FIT" | "DOUBTFUL" | "INJURED";
export const DOUBTFUL = "DOUBTFUL";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function injuryStatus(p: { injured: boolean; injuryReturn: string | null }): InjuryStatus {
  if (!p.injured) return "FIT";
  return p.injuryReturn === DOUBTFUL ? "DOUBTFUL" : "INJURED";
}

/** Valores para gravar a partir do formulário do comissário. */
export function injuryFromForm(status: string, returnDate: string): { injured: boolean; injuryReturn: string | null } {
  if (status === "DOUBTFUL") return { injured: true, injuryReturn: DOUBTFUL };
  if (status === "INJURED") return { injured: true, injuryReturn: ISO_DATE.test(returnDate) ? returnDate : null };
  return { injured: false, injuryReturn: null };
}

/** Texto curto para badges: "Lesionado · volta 20/11", "Dúvida". */
export function injuryLabel(p: { injured: boolean; injuryReturn: string | null }, now = new Date()): string | null {
  const status = injuryStatus(p);
  if (status === "FIT") return null;
  if (status === "DOUBTFUL") return "Dúvida";
  if (!p.injuryReturn || !ISO_DATE.test(p.injuryReturn)) return "Lesionado · sem previsão";
  const [y, m, d] = p.injuryReturn.split("-");
  const sameYear = Number(y) === now.getFullYear();
  return `Lesionado · volta ${d}/${m}${sameYear ? "" : `/${y}`}`;
}
