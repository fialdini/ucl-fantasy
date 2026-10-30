import Link from "next/link";
import type { Position } from "@/domain/types";
import { POSITION_SHIRT, pts } from "./ui";

export interface PitchPlayer {
  playerId: number;
  name: string;
  position: Position;
  club: string;
  /** null = ainda sem pontuação na rodada. */
  points: number | null;
  /** Projeção da rodada, mostrada enquanto o jogador ainda não pontuou. */
  projected?: number | null;
  warning?: boolean;
  injured?: boolean;
  href?: string;
}

/** Sobrenome (ou nome único) para caber na camisa. */
const shortName = (name: string) => name.split(" ").filter(Boolean).at(-1) ?? name;

function Shirt({ p, small = false }: { p: PitchPlayer; small?: boolean }) {
  return (
    <Link href={p.href ?? "#"} className={`group flex flex-col items-center ${small ? "w-16" : "w-[4.5rem] sm:w-20"}`}>
      <div className="relative">
        <div
          className={`grid place-items-center rounded-xl bg-linear-to-b font-display font-bold shadow-lg shadow-black/40 ring-2 ring-white/30 ${POSITION_SHIRT[p.position]} ${small ? "size-9 text-sm" : "size-11 text-base sm:size-12"}`}
        >
          {p.club.slice(0, 3)}
        </div>
        {p.warning && <span className="absolute -right-1 -top-1 size-3 rounded-full bg-red-500 ring-2 ring-night-950" title="Precisa de troca" />}
        {p.injured && (
          <span className="absolute -left-1.5 -top-1.5 grid size-4 place-items-center rounded-full bg-red-600 text-[10px] font-bold text-white ring-2 ring-night-950" title="Lesionado">
            ✚
          </span>
        )}
      </div>
      <span className="mt-1 max-w-full truncate rounded bg-night-950/80 px-1.5 text-[11px] font-semibold text-white group-hover:text-accent">{shortName(p.name)}</span>
      <span
        className={`num mt-0.5 rounded px-1.5 text-xs font-bold ${p.points === null ? "bg-white/10 text-slate-300" : p.points < 0 ? "bg-red-500 text-white" : "bg-accent text-night-950"}`}
        title={p.points === null ? "Projeção" : "Pontos na rodada"}
      >
        {p.points !== null ? pts(p.points) : p.projected != null ? `p ${pts(p.projected)}` : "–"}
      </span>
    </Link>
  );
}

/** Campinho com os titulares por linha (ataque em cima) e o banco embaixo. */
export function Pitch({ starters, bench }: { starters: PitchPlayer[]; bench: PitchPlayer[] }) {
  const rows: Position[] = ["FWD", "MID", "DEF", "GK"];
  return (
    <div className="overflow-hidden rounded-2xl ring-1 ring-white/10">
      <div className="pitch flex flex-col justify-around gap-4 px-2 py-5" style={{ minHeight: "26rem" }}>
        {rows.map((pos) => (
          <div key={pos} className="flex justify-center gap-1 sm:gap-3">
            {starters
              .filter((p) => p.position === pos)
              .map((p) => (
                <Shirt key={p.playerId} p={p} />
              ))}
          </div>
        ))}
      </div>
      {bench.length > 0 && (
        <div className="bg-night-850/90 px-3 py-3">
          <p className="label mb-2 text-center">Banco</p>
          <div className="flex flex-wrap justify-center gap-2">
            {bench.map((p) => (
              <Shirt key={p.playerId} p={p} small />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
