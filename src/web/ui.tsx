import type { PlayerRoundStatus } from "@/domain/matchup";
import type { Position } from "@/domain/types";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const param = (sp: Record<string, string | string[] | undefined>, key: string) => {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
};

export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const error = param(sp, "error");
  const ok = param(sp, "ok");
  if (!error && !ok) return null;
  return (
    <div
      role="status"
      className={`mb-4 rounded-lg px-3 py-2 text-sm ${error ? "bg-red-50 text-red-800 ring-1 ring-red-200" : "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"}`}
    >
      {error ?? ok}
    </div>
  );
}

const POSITION_STYLE: Record<Position, string> = {
  GK: "bg-amber-100 text-amber-800",
  DEF: "bg-sky-100 text-sky-800",
  MID: "bg-emerald-100 text-emerald-800",
  FWD: "bg-rose-100 text-rose-800",
};
export const POSITION_LABEL: Record<Position, string> = { GK: "GOL", DEF: "DEF", MID: "MEI", FWD: "ATA" };

export function Pos({ position }: { position: Position }) {
  return (
    <span className={`inline-block w-10 rounded px-1 py-0.5 text-center text-[11px] font-bold ${POSITION_STYLE[position]}`}>
      {POSITION_LABEL[position]}
    </span>
  );
}

const STATUS_LABEL: Record<PlayerRoundStatus, string> = {
  SCORED: "",
  DID_NOT_PLAY: "Não jogou",
  AWAITING_DATA: "Aguardando dados oficiais",
  NOT_STARTED: "A jogar",
  LIVE: "Em andamento",
  NO_MATCH: "Sem jogo",
};

export function PlayerStatus({ status }: { status: PlayerRoundStatus }) {
  if (status === "SCORED") return null;
  const tone = status === "AWAITING_DATA" ? "text-amber-700" : "text-slate-500";
  return <span className={`text-xs ${tone}`}>{STATUS_LABEL[status]}</span>;
}

export function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "amber" | "red" | "blue" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800",
    blue: "bg-brand-700/10 text-brand-700",
  };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

export const formatDate = (d: Date | null | undefined) =>
  d
    ? d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })
    : "a definir";
