"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DraftState } from "@/app/api/leagues/[id]/draft/route";
import type { Position } from "@/domain/types";

const LABEL: Record<Position, string> = { GK: "GOL", DEF: "DEF", MID: "MEI", FWD: "ATA" };
const POLL_MS = 2000;

/**
 * Sala de draft. O servidor é a autoridade do tempo: cada polling executa os auto-picks vencidos.
 * (Para tempo real com push, troque o polling por SSE/WebSocket mantendo a mesma rota de estado.)
 */
export function DraftRoom({ leagueId }: { leagueId: number }) {
  const [state, setState] = useState<DraftState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<Position | "">("");
  const [q, setQ] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const offset = useRef(0);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (position) p.set("position", position);
    if (q) p.set("q", q);
    return p.toString();
  }, [position, q]);

  const apply = useCallback((s: DraftState) => {
    offset.current = new Date(s.serverNow).getTime() - Date.now();
    setState(s);
  }, []);

  const inFlight = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Uma consulta por vez; falhas aparecem na tela e a próxima consulta tenta de novo. */
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/leagues/${leagueId}/draft?${query}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 401 ? "Sessão expirada: entre novamente" : `Erro ${res.status} no servidor`);
      apply((await res.json()) as DraftState);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Falha de conexão");
    } finally {
      inFlight.current = false;
    }
  }, [leagueId, query, apply]);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [refresh]);

  async function pick(playerId: number) {
    setError(null);
    const res = await fetch(`/api/leagues/${leagueId}/draft?${query}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    const body = (await res.json()) as DraftState | { error: string };
    if ("error" in body) setError(body.error);
    else apply(body);
  }

  if (!state) {
    return (
      <p className="card text-sm text-slate-500">
        {loadError ? `Não foi possível carregar o draft (${loadError}). Tentando de novo…` : "Carregando sala de draft…"}
      </p>
    );
  }
  if (state.status === "SETUP") return <p className="card text-sm">O comissário ainda não iniciou o draft.</p>;

  const teamName = (id: number | null) => state.teams.find((t) => t.id === id)?.name ?? "—";
  const myTurn = state.status === "DRAFTING" && state.onClockTeamId === state.myTeamId;
  const remaining = state.deadline
    ? Math.max(0, Math.ceil((new Date(state.deadline).getTime() - (now + offset.current)) / 1000))
    : 0;
  const counts = (p: Position) => state.myRoster.filter((r) => r.position === p).length;
  const clubCount = (clubId: number) => state.myRoster.filter((r) => r.clubId === clubId).length;
  const blocked = (p: DraftState["available"][number]) =>
    counts(p.position) >= state.quotas[p.position] ? "posição completa" : clubCount(p.clubId) >= state.clubCap ? "limite do clube" : null;
  const teamsCount = state.order.length || 1;

  return (
    <div className="space-y-4">
      {state.status === "DRAFTING" ? (
        <div className={`card flex items-center justify-between gap-3 ${myTurn ? "bg-emerald-50 ring-emerald-300" : ""}`}>
          <div>
            <p className="label">
              Pick {(state.currentPick ?? 0) + 1} de {state.totalPicks} · Rodada {Math.floor((state.currentPick ?? 0) / teamsCount) + 1}
            </p>
            <p className="text-lg font-bold">{myTurn ? "Sua vez!" : `Na vez: ${teamName(state.onClockTeamId)}`}</p>
            <p className="text-xs text-slate-500">Se o tempo acabar, o melhor jogador do ranking é escolhido automaticamente.</p>
          </div>
          <div className={`font-mono text-4xl font-bold tabular-nums ${remaining <= 10 ? "text-red-600" : "text-brand-900"}`}>
            {remaining}s
          </div>
        </div>
      ) : (
        <p className="card bg-emerald-50 font-semibold text-emerald-900">Draft concluído! Confira seu time em “Meu time”.</p>
      )}
      {(error ?? loadError) && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">{error ?? `Conexão instável: ${loadError}`}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <section className="card">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="mr-auto font-semibold">Disponíveis</h2>
            <select className="input w-auto" value={position} onChange={(e) => setPosition(e.target.value as Position | "")}>
              <option value="">Todas</option>
              {(Object.keys(LABEL) as Position[]).map((p) => (
                <option key={p} value={p}>
                  {LABEL[p]} ({counts(p)}/{state.quotas[p]})
                </option>
              ))}
            </select>
            <input className="input w-36" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <ul className="max-h-[28rem] divide-y divide-slate-100 overflow-y-auto text-sm">
            {state.available.map((p) => {
              const reason = blocked(p);
              return (
                <li key={p.playerId} className="flex items-center gap-2 py-1.5">
                  <span className="w-9 text-[11px] font-bold text-slate-500">{LABEL[p.position]}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {p.name} <span className="text-slate-400">· {p.club}</span>
                  </span>
                  <span className="w-12 text-right tabular-nums text-slate-600">{p.total} pts</span>
                  <button className="btn px-2 py-1 text-xs" disabled={!myTurn || reason !== null} title={reason ?? ""} onClick={() => void pick(p.playerId)}>
                    Escolher
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="card">
          <h2 className="mb-3 font-semibold">Escolhas</h2>
          <ol className="max-h-[28rem] space-y-1 overflow-y-auto text-sm">
            {[...state.picks].reverse().map((p) => (
              <li key={p.overall} className={`flex gap-2 rounded px-2 py-1 ${p.teamId === state.myTeamId ? "bg-brand-700/5" : ""}`}>
                <span className="w-10 tabular-nums text-slate-400">#{p.overall + 1}</span>
                <span className="w-28 truncate font-medium">{teamName(p.teamId)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {LABEL[p.position]} {p.name} <span className="text-slate-400">· {p.club}</span>
                </span>
                {p.auto && <span className="text-xs text-amber-700">auto</span>}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
