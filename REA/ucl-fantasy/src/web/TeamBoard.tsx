"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { moveToSlotAction, swapPlayersAction } from "@/app/actions";
import { SUB_POSITIONS, SUB_SHORT, type SubPosition } from "@/domain/subpositions";
import type { PlayerRoundStatus } from "@/domain/matchup";
import type { Position } from "@/domain/types";
import { PlayerAvatar } from "./PlayerAvatar";
import { PlayerStatus, Rating, SubPos, pts } from "./ui";

export interface BoardPlayer {
  playerId: number;
  name: string;
  position: Position;
  subPosition: SubPosition;
  club: string;
  photoUrl: string | null;
  slot: "STARTER" | "BENCH";
  /** null = ainda sem pontuação na rodada. */
  points: number | null;
  status: PlayerRoundStatus | null;
  projected: number;
  avg: number;
  games: number;
  /** Texto do selo de lesão (já formatado) e se é só dúvida. */
  injury: string | null;
  injuryDoubt: boolean;
  injuryNote: string | null;
  bye: string | null;
  warning: string | null;
  href: string;
}

const ROWS: Position[] = ["FWD", "MID", "DEF", "GK"];
/** Sub-posição que fica nas pontas de cada linha (as outras ficam no meio). */
const EDGE: Partial<Record<Position, SubPosition>> = { FWD: "WG", MID: "AM", DEF: "FB" };

/** Pontas nas extremidades e o resto no centro, para a linha parecer um time de verdade. */
function arrangeRow(players: BoardPlayer[], position: Position): BoardPlayer[] {
  const edge = players.filter((p) => p.subPosition === EDGE[position]);
  const center = players.filter((p) => p.subPosition !== EDGE[position]);
  return [...edge.filter((_, i) => i % 2 === 0), ...center, ...edge.filter((_, i) => i % 2 === 1)];
}

const shortName = (name: string) => name.split(" ").filter(Boolean).at(-1) ?? name;

export function TeamBoard({ leagueId, players, locked }: { leagueId: number; players: BoardPlayer[]; locked: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byId = new Map(players.map((p) => [p.playerId, p]));
  const held = byId.get(dragging ?? selected ?? -1) ?? null;
  // Só troca dentro da mesma sub-posição (lateral por lateral…).
  const canSwap = (a: BoardPlayer | null, b: BoardPlayer) => !!a && a.playerId !== b.playerId && a.slot !== b.slot && a.subPosition === b.subPosition;

  function swap(aId: number, bId: number) {
    setSelected(null);
    setDragging(null);
    setError(null);
    startTransition(async () => {
      const result = await swapPlayersAction(leagueId, aId, bId);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  function move(playerId: number, slot: "STARTER" | "BENCH") {
    setSelected(null);
    setDragging(null);
    setError(null);
    startTransition(async () => {
      const result = await moveToSlotAction(leagueId, playerId, slot);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  function pick(p: BoardPlayer) {
    if (locked) return;
    if (selected === null || selected === p.playerId) return setSelected(selected === p.playerId ? null : p.playerId);
    if (canSwap(byId.get(selected) ?? null, p)) return swap(selected, p.playerId);
    setSelected(p.playerId);
  }

  const starters = players.filter((p) => p.slot === "STARTER");
  const bench = players.filter((p) => p.slot === "BENCH");

  // Função (não componente): um componente declarado aqui seria recriado a cada render e quebraria o arrastar.
  const card = (p: BoardPlayer, small = false) => {
    const eligible = held !== null && canSwap(held, p);
    const isHeld = held?.playerId === p.playerId;
    return (
      <div
        key={p.playerId}
        draggable={!locked}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(p.playerId));
          setDragging(p.playerId);
          setSelected(null);
        }}
        onDragEnd={() => setDragging(null)}
        onDragOver={(e) => {
          if (eligible) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (dragging !== null && canSwap(byId.get(dragging) ?? null, p)) swap(dragging, p.playerId);
        }}
        className={`group relative flex flex-col items-center rounded-xl p-1 transition ${small ? "w-[4.6rem]" : "w-[4.9rem] sm:w-24"} ${locked ? "" : "cursor-grab active:cursor-grabbing"} ${
          isHeld ? "scale-105 bg-accent/25 ring-2 ring-accent" : eligible ? "bg-white/15 ring-2 ring-white/60 animate-pulse" : "hover:bg-white/10"
        } ${dragging !== null && !eligible && !isHeld ? "opacity-50" : ""}`}
      >
        <Link href={p.href} draggable={false} className="flex flex-col items-center">
          <span className="relative">
            <PlayerAvatar name={p.name} photoUrl={p.photoUrl} position={p.position} className={small ? "size-11 text-sm" : "size-12 text-base sm:size-14"} />
            {p.injury && (
              <span
                className={`absolute -left-1 -top-1 grid size-4 place-items-center rounded-full text-[10px] font-bold text-white ring-2 ring-night-950 ${p.injuryDoubt ? "bg-amber-500" : "bg-red-600"}`}
                title={p.injury}
              >
                ✚
              </span>
            )}
            {(p.warning || p.bye) && <span className="absolute -right-1 -top-1 size-3 rounded-full bg-red-500 ring-2 ring-night-950" title={p.warning ?? p.bye ?? ""} />}
            <span className="absolute -bottom-1 -right-1.5 rounded bg-night-950/90 px-1 text-[9px] font-bold tracking-wide text-slate-200 ring-1 ring-white/20">{SUB_SHORT[p.subPosition]}</span>
          </span>
          <span className="mt-1.5 max-w-full truncate rounded bg-night-950/80 px-1.5 text-[11px] font-semibold text-white group-hover:text-accent">{shortName(p.name)}</span>
          <span className="text-[10px] text-slate-300/80">{p.club}</span>
        </Link>
        <span
          className={`num mt-0.5 rounded px-1.5 text-xs font-bold ${p.points === null ? "bg-white/10 text-slate-300" : p.points < 0 ? "bg-red-500 text-white" : "bg-accent text-night-950"}`}
          title={p.points === null ? "Projeção para a rodada" : "Pontos na rodada"}
        >
          {p.points !== null ? pts(p.points) : p.projected > 0 ? `p ${pts(p.projected)}` : "–"}
        </span>
      </div>
    );
  };

  const section = (title: string, list: BoardPlayer[]) => (
    <>
      <tr>
        <td colSpan={8} className="bg-night-800/60 px-2 py-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-300">
          {title} <span className="text-slate-400">({list.length})</span>
        </td>
      </tr>
      {[...list]
        .sort((a, b) => SUB_POSITIONS.indexOf(a.subPosition) - SUB_POSITIONS.indexOf(b.subPosition))
        .map((p) => {
          const eligible = held !== null && canSwap(held, p);
          const isHeld = held?.playerId === p.playerId;
          return (
            <tr
              key={p.playerId}
              className={`${isHeld ? "bg-accent/15" : eligible ? "bg-white/[0.08]" : ""} ${p.slot === "BENCH" ? "text-slate-300" : ""}`}
              onDragOver={(e) => eligible && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging !== null && canSwap(byId.get(dragging) ?? null, p)) swap(dragging, p.playerId);
              }}
            >
              <td className="w-16 whitespace-nowrap">
                {!locked && (
                  <button
                    type="button"
                    onClick={() => pick(p)}
                    title={isHeld ? "Cancelar" : eligible ? "Trocar com o selecionado" : "Selecionar para trocar de lugar"}
                    className={`inline-grid size-6 place-items-center rounded-md text-xs ring-1 transition ${isHeld ? "bg-accent text-night-950 ring-accent" : eligible ? "bg-white text-night-950 ring-white" : "text-slate-400 ring-white/15 hover:text-white hover:ring-white/40"}`}
                  >
                    ⇄
                  </button>
                )}
                {!locked && (
                  <button
                    type="button"
                    onClick={() => move(p.playerId, p.slot === "STARTER" ? "BENCH" : "STARTER")}
                    title={p.slot === "STARTER" ? "Mandar para o banco (joga com um a menos)" : "Escalar numa vaga livre da posição"}
                    className="ml-1 inline-grid size-6 place-items-center rounded-md text-xs text-slate-400 ring-1 ring-white/15 transition hover:text-white hover:ring-white/40"
                  >
                    {p.slot === "STARTER" ? "↓" : "↑"}
                  </button>
                )}
              </td>
              <td>
                <div className="flex items-center gap-2">
                  <SubPos position={p.position} sub={p.subPosition} />
                  <PlayerAvatar name={p.name} photoUrl={p.photoUrl} position={p.position} className="size-8 text-[10px]" />
                  <div className="min-w-0">
                    <Link href={p.href} className="block truncate font-semibold hover:text-accent hover:underline">
                      {p.name}
                    </Link>
                    <div className="flex flex-wrap items-center gap-1 text-[11px]">
                      {p.injury && (
                        <span className={p.injuryDoubt ? "text-amber-300" : "text-red-300"} title={p.injuryNote ?? undefined}>
                          ✚ {p.injury}
                        </span>
                      )}
                      {p.bye && <span className="text-brand-300">Bye {p.bye}</span>}
                      {p.warning && <span className="text-red-300">{p.warning}</span>}
                      {p.status && <PlayerStatus status={p.status} />}
                    </div>
                  </div>
                </div>
              </td>
              <td className="hidden text-slate-400 sm:table-cell">{p.club}</td>
              <td className="text-right">{p.points !== null ? <Rating points={p.points} /> : <span className="text-slate-500">–</span>}</td>
              <td className="num text-right text-accent">{p.projected > 0 ? pts(p.projected) : "–"}</td>
              <td className="num text-right text-slate-200" title={`${p.games} jogo(s)`}>
                {pts(p.avg)}
              </td>
              <td className="num hidden text-right text-slate-400 sm:table-cell">{p.games}</td>
            </tr>
          );
        })}
    </>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="space-y-2 lg:sticky lg:top-20 lg:self-start">
        <div className="overflow-hidden rounded-2xl ring-1 ring-white/10">
          <div
            className="pitch flex flex-col justify-around gap-2 px-2 py-4"
            style={{ minHeight: "30rem" }}
            onDragOver={(e) => held?.slot === "BENCH" && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging !== null && byId.get(dragging)?.slot === "BENCH") move(dragging, "STARTER");
            }}
          >
            {ROWS.map((position) => (
              <div key={position} className="flex justify-center gap-0.5 sm:gap-2">
                {arrangeRow(
                  starters.filter((p) => p.position === position),
                  position,
                ).map((p) => card(p))}
              </div>
            ))}
          </div>
          <div
            className="bg-night-850/95 px-3 py-3"
            onDragOver={(e) => held?.slot === "STARTER" && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging !== null && byId.get(dragging)?.slot === "STARTER") move(dragging, "BENCH");
            }}
          >
            <p className="label mb-2 text-center">Banco ({bench.length})</p>
            <div className="flex flex-wrap justify-center gap-1">
              {bench.map((p) => card(p, true))}
            </div>
          </div>
        </div>
        <p className="text-center text-xs text-slate-400">
          {locked ? "🔒 Escalação travada" : "Arraste um reserva sobre um titular da mesma sub-posição (ou o contrário) para trocar. Solte um titular no banco para jogar com um a menos, ou um reserva no campo para ocupar uma vaga livre. O botão ⇄ na lista faz o mesmo."}
        </p>
        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200 ring-1 ring-red-500/30">⚠ {error}</p>}
        {pending && <p className="text-center text-xs text-accent">Salvando…</p>}
      </div>

      <div className="card overflow-x-auto p-0 sm:p-0">
        <table className="table">
          <thead>
            <tr>
              <th className="w-16" />
              <th>Jogador</th>
              <th className="hidden sm:table-cell">Clube</th>
              <th className="text-right">Rodada</th>
              <th className="text-right" title="Projeção de pontos para a rodada">
                Proj.
              </th>
              <th className="text-right" title="Média de pontos por jogo na temporada">
                Média
              </th>
              <th className="hidden text-right sm:table-cell">Jogos</th>
            </tr>
          </thead>
          <tbody>
            {section("Titulares", starters)}
            {section("Reservas", bench)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

