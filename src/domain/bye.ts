/**
 * Bye week: rodada em que o clube do jogador não entra em campo (e o jogador não pontua), como no
 * NFL Fantasy. Na Champions não há folga na fase de liga (todo clube joga as 8 rodadas); ela aparece
 * no playoff (rodadas 9–10), que os 8 primeiros da fase de liga pulam, e depois que o clube é eliminado.
 */

/** Jogos de cada rodada quando o chaveamento já está completo (rodada 1–17). */
export function expectedMatches(roundOrder: number): number {
  if (roundOrder <= 8) return 18;
  if (roundOrder <= 12) return 8;
  if (roundOrder <= 14) return 4;
  if (roundOrder <= 16) return 2;
  return 1;
}

export type RoundAvailability = "PLAYS" | "BYE" | "ELIMINATED" | "TBD";

/** Rodadas de playoff, que os 8 primeiros da fase de liga pulam. */
const PLAYOFF_ROUNDS = new Set([9, 10]);

type Fixture = { homeClubId: number; awayClubId: number };
const plays = (clubId: number, matches: ReadonlyArray<Fixture>) => matches.some((m) => m.homeClubId === clubId || m.awayClubId === clubId);

/**
 * Situação do clube na rodada. Folga (BYE) só existe no playoff, para quem segue vivo (`alive`: o top 8,
 * que reaparece nas oitavas). Ausência de um chaveamento completo no mata-mata é eliminação: já
 * registrada (ELIMINATED) ou ainda por acontecer (TBD). Chaveamento incompleto: TBD.
 */
export function roundAvailability(
  roundOrder: number,
  clubId: number,
  roundMatches: ReadonlyArray<Fixture>,
  eliminatedAfterRound: number | null,
  alive = false,
): RoundAvailability {
  if (plays(clubId, roundMatches)) return "PLAYS";
  if (eliminatedAfterRound !== null && roundOrder > eliminatedAfterRound) return "ELIMINATED";
  if (roundMatches.length < expectedMatches(roundOrder)) return "TBD";
  return PLAYOFF_ROUNDS.has(roundOrder) && alive ? "BYE" : "TBD";
}

/** Oitavas (primeira rodada depois do playoff). */
const ROUND_OF_16 = 11;

/**
 * O clube segue vivo depois do playoff? Sim se está nas oitavas; com as oitavas ainda não sorteadas,
 * vale quem não foi eliminado (quem caiu na fase de liga já está marcado como eliminado).
 */
export function aliveAfterPlayoff(clubId: number, matchesByRound: ReadonlyMap<number, ReadonlyArray<Fixture>>): boolean {
  const r16 = matchesByRound.get(ROUND_OF_16) ?? [];
  return r16.length < expectedMatches(ROUND_OF_16) || plays(clubId, r16);
}

/** Rodadas de bye do clube entre `from` e `to`. */
export function byeRounds(
  clubId: number,
  matchesByRound: ReadonlyMap<number, ReadonlyArray<{ homeClubId: number; awayClubId: number }>>,
  eliminatedAfterRound: number | null,
  from: number,
  to: number,
): number[] {
  const result: number[] = [];
  for (let r = from; r <= to; r++) {
    const status = roundAvailability(r, clubId, matchesByRound.get(r) ?? [], eliminatedAfterRound, aliveAfterPlayoff(clubId, matchesByRound));
    if (status === "BYE") result.push(r);
  }
  return result;
}
