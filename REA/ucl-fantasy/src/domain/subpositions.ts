import type { Position } from "./types";

/**
 * Sub-posições do elenco. Cada uma pertence a uma das 4 posições da pontuação (a tabela de pontos
 * continua por posição); as sub-posições só organizam o elenco e a escalação.
 */
export const SUB_POSITIONS = ["GK", "CB", "FB", "DM", "AM", "WG", "ST"] as const;
export type SubPosition = (typeof SUB_POSITIONS)[number];

export const SUB_PARENT: Record<SubPosition, Position> = { GK: "GK", CB: "DEF", FB: "DEF", DM: "MID", AM: "MID", WG: "FWD", ST: "FWD" };

export const SUB_LABEL: Record<SubPosition, string> = {
  GK: "Goleiro",
  CB: "Zagueiro",
  FB: "Lateral",
  DM: "Volante",
  AM: "Meia",
  WG: "Ponta",
  ST: "Centroavante",
};
export const SUB_PLURAL: Record<SubPosition, string> = {
  GK: "Goleiros",
  CB: "Zagueiros",
  FB: "Laterais",
  DM: "Volantes",
  AM: "Meias",
  WG: "Pontas",
  ST: "Centroavantes",
};
/** Sigla de 3 letras para chips e tabelas. */
export const SUB_SHORT: Record<SubPosition, string> = { GK: "GOL", CB: "ZAG", FB: "LAT", DM: "VOL", AM: "MEI", WG: "PON", ST: "CA" };

export const isSubPosition = (value: unknown): value is SubPosition => (SUB_POSITIONS as readonly unknown[]).includes(value);

export const subsOf = (position: Position): SubPosition[] => SUB_POSITIONS.filter((s) => SUB_PARENT[s] === position);

/** Sub-posição de quem a fonte não classifica. */
export const DEFAULT_SUB: Record<Position, SubPosition> = { GK: "GK", DEF: "CB", MID: "AM", FWD: "ST" };

/** Sub-posição válida para a posição: a informada se combina, senão a padrão. */
export function subOrDefault(position: Position, sub: string | null | undefined): SubPosition {
  return isSubPosition(sub) && SUB_PARENT[sub] === position ? sub : DEFAULT_SUB[position];
}

// ---------- Classificação a partir da súmula ----------

/** Posição tática detalhada da UEFA (`detailedFieldPosition`), quando preenchida. */
const DETAILED: Record<string, SubPosition> = {
  STRIKER: "ST",
  WINGER: "WG",
  ATTACKING_MIDFIELDER: "AM",
  CENTRAL_MIDFIELDER: "AM",
  DEFENSIVE_MIDFIELDER: "DM",
  FULL_BACK: "FB",
  CENTRE_BACK: "CB",
};

export interface LineupEntry {
  position: Position;
  detailed?: string | null;
  /** Coordenada no campo (0–1000 de largura; y cresce em direção ao ataque). Só titulares têm. */
  x?: number | null;
  y?: number | null;
}

const WIDE = (x: number) => x <= 250 || x >= 750;

/**
 * Sub-posição de uma escalação. A posição tática informada vale quando combina com a posição;
 * senão usa a coordenada do titular; sem nenhuma das duas, null (o chamador usa o padrão).
 * `frontLine` = quantos atacantes titulares o time tinha (3 = ponta-centroavante-ponta).
 */
export function classifyLineup(entry: LineupEntry, frontLine = 2): SubPosition | null {
  const { position } = entry;
  if (position === "GK") return "GK";
  const detailed = entry.detailed ? DETAILED[entry.detailed] : undefined;
  if (detailed && SUB_PARENT[detailed] === position) return detailed;
  // Posição tática de outra linha (lateral anotado como ponta, volante como zagueiro…): aproxima.
  if (position === "DEF" && (entry.detailed === "WINGER" || entry.detailed === "FULL_BACK")) return "FB";
  if (position === "MID" && entry.detailed === "WINGER") return "AM";
  if (entry.x == null || entry.y == null) return null;
  if (position === "DEF") return WIDE(entry.x) ? "FB" : "CB";
  if (position === "MID") return entry.y < 450 ? "DM" : "AM";
  return WIDE(entry.x) || (frontLine >= 3 && (entry.x <= 350 || entry.x >= 650)) ? "WG" : "ST";
}

/** Sub-posição mais frequente entre as escalações do jogador; empate favorece a mais "informativa". */
export function dominantSub(position: Position, votes: ReadonlyArray<SubPosition | null>): SubPosition {
  const counts = new Map<SubPosition, number>();
  for (const v of votes) if (v && SUB_PARENT[v] === position) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: SubPosition | null = null;
  for (const [sub, n] of counts) if (!best || n > counts.get(best)!) best = sub;
  return best ?? DEFAULT_SUB[position];
}
