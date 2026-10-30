import type { PlayerRoundStatus } from "@/domain/matchup";
import { SUB_LABEL, SUB_SHORT, subOrDefault, type SubPosition } from "@/domain/subpositions";
import type { Position } from "@/domain/types";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const param = (sp: Record<string, string | string[] | undefined>, key: string) => {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
};

export function Logo({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4f6bff" />
          <stop offset="1" stopColor="#00e0c6" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="#080d26" stroke="url(#logo-g)" strokeWidth="2" />
      <path d="M16 6.5l2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L16 21l-5.7 3 1.1-6.3-4.6-4.5 6.4-.9z" fill="url(#logo-g)" />
    </svg>
  );
}

export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const error = param(sp, "error");
  const ok = param(sp, "ok");
  if (!error && !ok) return null;
  return (
    <div
      role="status"
      className={`mb-4 flex items-start gap-2 rounded-xl px-4 py-3 text-sm ring-1 ${error ? "bg-red-500/10 text-red-200 ring-red-500/30" : "bg-emerald-500/10 text-emerald-200 ring-emerald-500/30"}`}
    >
      <span aria-hidden>{error ? "⚠" : "✓"}</span>
      <span>{error ?? ok}</span>
    </div>
  );
}

export const POSITION_STYLE: Record<Position, string> = {
  GK: "bg-amber-400/15 text-amber-300 ring-amber-400/30",
  DEF: "bg-sky-400/15 text-sky-300 ring-sky-400/30",
  MID: "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30",
  FWD: "bg-rose-400/15 text-rose-300 ring-rose-400/30",
};
/** Cor sólida da "camisa" de cada posição no campinho. */
export const POSITION_SHIRT: Record<Position, string> = {
  GK: "from-amber-300 to-amber-500 text-amber-950",
  DEF: "from-sky-300 to-sky-500 text-sky-950",
  MID: "from-emerald-300 to-emerald-500 text-emerald-950",
  FWD: "from-rose-300 to-rose-500 text-rose-950",
};
export const POSITION_LABEL: Record<Position, string> = { GK: "GOL", DEF: "DEF", MID: "MEI", FWD: "ATA" };
export const POSITION_NAME: Record<Position, string> = { GK: "Goleiros", DEF: "Defensores", MID: "Meias", FWD: "Atacantes" };

export function Pos({ position }: { position: Position }) {
  return (
    <span className={`inline-block w-10 shrink-0 rounded-md px-1 py-0.5 text-center text-[10px] font-bold tracking-wider ring-1 ${POSITION_STYLE[position]}`}>
      {POSITION_LABEL[position]}
    </span>
  );
}

const SUB_ICON: Record<SubPosition, string> = { GK: "🧤", CB: "🛡", FB: "↔", DM: "⚙", AM: "✦", WG: "⚡", ST: "⚽" };

/** Chip da sub-posição (ZAG, LAT, VOL, MEI, PON, CA, GOL) na cor da posição. */
export function SubPos({ position, sub }: { position: Position; sub?: SubPosition | string | null }) {
  const value = subOrDefault(position, sub);
  return (
    <span
      title={SUB_LABEL[value]}
      className={`inline-flex w-14 shrink-0 items-center justify-center gap-1 rounded-full px-1.5 py-0.5 text-center text-[10px] font-bold tracking-wider ring-1 ${POSITION_STYLE[position]}`}
    >
      <span aria-hidden>{SUB_ICON[value]}</span>
      {SUB_SHORT[value]}
    </span>
  );
}

/** Nota no estilo do Football Manager: cor pela faixa de pontos. */
export const ratingClass = (points: number) =>
  points >= 10 ? "bg-emerald-500 text-white" : points >= 6 ? "bg-emerald-700/80 text-emerald-50" : points >= 3 ? "bg-lime-800/70 text-lime-100" : points >= 0 ? "bg-amber-700/60 text-amber-100" : "bg-red-600 text-white";

/** Nota arredondada numa pastilha colorida. */
export function Rating({ points, className = "" }: { points: number; className?: string }) {
  return <span className={`num inline-block min-w-11 rounded px-1.5 py-0.5 text-center text-sm font-bold ${ratingClass(points)} ${className}`}>{pts(points)}</span>;
}

const STATUS_LABEL: Record<PlayerRoundStatus, string> = {
  SCORED: "",
  DID_NOT_PLAY: "Não jogou",
  AWAITING_DATA: "Aguardando dados oficiais",
  NOT_STARTED: "A jogar",
  LIVE: "Em andamento",
  NO_MATCH: "Bye (sem jogo)",
};

export function PlayerStatus({ status }: { status: PlayerRoundStatus }) {
  if (status === "SCORED") return null;
  const tone = status === "AWAITING_DATA" ? "text-amber-300" : status === "LIVE" ? "text-accent" : "text-slate-500";
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${tone}`}>
      {status === "LIVE" && <span className="size-1.5 animate-pulse rounded-full bg-accent" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

export type Tone = "slate" | "green" | "amber" | "red" | "blue" | "accent";

export function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: Tone }) {
  const tones: Record<Tone, string> = {
    slate: "bg-white/5 text-slate-300 ring-white/10",
    green: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/25",
    amber: "bg-amber-400/10 text-amber-300 ring-amber-400/25",
    red: "bg-red-400/10 text-red-300 ring-red-400/25",
    blue: "bg-brand-500/15 text-brand-300 ring-brand-500/30",
    accent: "bg-accent/10 text-accent ring-accent/30",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${tones[tone]}`}>{children}</span>
  );
}

/** Pontos no formato brasileiro, com até 2 casas (ex.: 7,9). */
export const pts = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
/** Mesmo formato, com sinal (ex.: +1,2). */
export const signedPts = (n: number) => (n > 0 ? `+${pts(n)}` : pts(n));

/** Pontos com sinal e cor: verde positivo, vermelho negativo. */
export function Delta({ points }: { points: number }) {
  return (
    <span className={`num font-semibold ${points > 0 ? "text-emerald-300" : points < 0 ? "text-red-300" : "text-slate-400"}`}>
      {signedPts(points)}
    </span>
  );
}

export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-bold uppercase tracking-wide">{children}</h2>
      {aside}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-slate-400">{children}</p>;
}

export const formatDate = (d: Date | null | undefined) =>
  d
    ? d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })
    : "a definir";
