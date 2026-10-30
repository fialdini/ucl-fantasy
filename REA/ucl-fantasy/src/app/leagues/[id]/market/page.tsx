import Link from "next/link";
import { game } from "@config/game";
import { cancelClaimAction, dropPlayerAction, freeAgentAction, setManagerAction, waiverClaimAction } from "@/app/actions";
import { injuryLabel, injuryStatus } from "@/domain/injuries";
import { SUB_PLURAL, SUB_POSITIONS, SUB_PARENT, isSubPosition } from "@/domain/subpositions";
import { teamOf } from "@/server/leagues";
import { leagueCoaches } from "@/server/manager";
import { projectRound } from "@/server/projections";
import { PlayerAvatar } from "@/web/PlayerAvatar";
import { allClubs, roundsState, rosterView, searchPlayers, teamClaims } from "@/web/queries";
import { requireMember } from "@/web/session";
import { Badge, Flash, formatDate, param, POSITION_LABEL, pts, Rating, SubPos, type SearchParams } from "@/web/ui";

const CLAIM_TONE = { PENDING: "blue", SUCCEEDED: "green", FAILED: "red", CANCELLED: "slate" } as const;
const CLAIM_LABEL = { PENDING: "Pendente", SUCCEEDED: "Atendido", FAILED: "Recusado", CANCELLED: "Cancelado" };
const OWNERSHIP = [
  { value: "all", label: "Todos" },
  { value: "free", label: "Sem time" },
  { value: "owned", label: "Com time" },
] as const;
const SORTS = [
  { value: "avg", label: "Média" },
  { value: "proj", label: "Projeção" },
  { value: "name", label: "Nome" },
] as const;

export default async function MarketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { league, user, db } = await requireMember(Number(id));
  const team = await teamOf(db, league.id, user.id);
  const canAct = !!team && league.status === "ACTIVE";
  const base = `/leagues/${league.id}/market`;

  const view = param(sp, "view") === "coaches" ? "coaches" : "players";
  const ownership = OWNERSHIP.find((o) => o.value === param(sp, "own"))?.value ?? "all";
  const sort = SORTS.find((s) => s.value === param(sp, "sort"))?.value ?? "avg";
  const subParam = param(sp, "sub") ?? "";
  const subPosition = isSubPosition(subParam) ? subParam : undefined;
  const clubId = Number(param(sp, "club")) || undefined;
  const q = param(sp, "q") || undefined;

  /** Link que muda só alguns filtros e mantém o resto. */
  const href = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const current: Record<string, string | undefined> = { view: view === "coaches" ? "coaches" : undefined, own: ownership === "all" ? undefined : ownership, sub: subPosition, club: clubId ? String(clubId) : undefined, q, sort: sort === "avg" ? undefined : sort };
    for (const [k, v] of Object.entries({ ...current, ...changes })) if (v) next.set(k, v);
    const qs = next.toString();
    return qs ? `${base}?${qs}` : base;
  };

  const [{ locked, current }, roster, claims, clubs] = await Promise.all([
    roundsState(db, new Date()),
    team ? rosterView(db, team.id) : Promise.resolve([]),
    team ? teamClaims(db, team.id) : Promise.resolve([]),
    allClubs(db),
  ]);
  const waiverOpen = league.waiverProcessAt !== null;
  const openSpots = game.roster.size - roster.length;
  const tabs = (
    <div className="flex flex-wrap gap-1.5">
      {[
        { value: "players", label: "Jogadores" },
        { value: "coaches", label: "Técnicos" },
      ].map((t) => (
        <Link
          key={t.value}
          href={href({ view: t.value === "coaches" ? "coaches" : undefined, sub: undefined, own: undefined, sort: undefined })}
          className={`rounded-lg px-4 py-1.5 text-sm font-bold uppercase tracking-wide ring-1 transition ${view === t.value ? "bg-accent text-night-950 ring-accent" : "text-slate-300 ring-white/15 hover:ring-white/40"}`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );

  if (view === "coaches") {
    const list = await leagueCoaches(db, league.id);
    const mine = list.find((c) => c.owner?.teamId === team?.id);
    return (
      <div className="space-y-4">
        <Flash sp={sp} />
        {tabs}
        <p className="text-sm text-slate-400">
          Cada time pode ter 1 técnico real, exclusivo na liga. Ele pontua pelo desempenho do clube dele na rodada (média dos jogadores + resultado). Troca livre enquanto a rodada não trava.
          {mine && (
            <>
              {" "}
              Seu técnico: <b className="text-slate-100">{mine.name}</b> ({mine.club}).
            </>
          )}
        </p>
        <div className="card overflow-x-auto p-0 sm:p-0">
          <table className="table">
            <thead>
              <tr>
                <th>Técnico</th>
                <th>Clube</th>
                <th>Dono</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className={c.eliminated !== null ? "opacity-50" : ""}>
                  <td>
                    <div className="flex items-center gap-2">
                      <PlayerAvatar name={c.name} photoUrl={c.photoUrl} position="GK" className="size-9 text-[10px]" />
                      <Link href={`/leagues/${league.id}/managers/${c.id}`} className="font-semibold hover:text-accent hover:underline">
                        {c.name}
                      </Link>
                    </div>
                  </td>
                  <td>
                    {c.clubName}
                    {c.eliminated !== null && <span className="ml-1 text-xs text-red-300">eliminado</span>}
                  </td>
                  <td className="text-xs">{c.owner?.teamName ?? <span className="text-emerald-300">livre</span>}</td>
                  <td className="text-right">
                    {canAct && !c.owner && c.eliminated === null && (
                      <form action={setManagerAction}>
                        <input type="hidden" name="leagueId" value={league.id} />
                        <input type="hidden" name="coachId" value={c.id} />
                        <input type="hidden" name="returnTo" value={`${base}?view=coaches`} />
                        <button className="btn px-3 py-1 text-xs" disabled={locked}>
                          {mine ? "Trocar" : "Contratar"}
                        </button>
                      </form>
                    )}
                    {c.owner?.teamId === team?.id && <Badge tone="green">Seu técnico</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const [found, projections] = await Promise.all([
    searchPlayers(db, {
      leagueId: league.id,
      subPosition,
      clubId,
      q,
      onlyFree: ownership === "free",
      onlyOwned: ownership === "owned",
      sort: sort === "name" ? "name" : "avg",
      limit: sort === "proj" ? 600 : 150,
    }),
    current ? projectRound(db, current.order) : Promise.resolve(new Map()),
  ]);
  const rows = (sort === "proj" ? [...found].sort((a, b) => (projections.get(b.playerId)?.points ?? 0) - (projections.get(a.playerId)?.points ?? 0)) : found).slice(0, 150);
  const dropOptions = (position: (typeof roster)[number]["position"]) =>
    [...roster].sort(
      (a, b) =>
        Number(b.position === position) - Number(a.position === position) ||
        Number(b.eliminated !== null) - Number(a.eliminated !== null) ||
        a.total - b.total,
    );
  const action = waiverOpen ? waiverClaimAction : freeAgentAction;
  const pill = (active: boolean) =>
    `rounded-lg px-3 py-1 text-xs font-bold uppercase tracking-wide ring-1 transition ${active ? "bg-accent text-night-950 ring-accent" : "text-slate-300 ring-white/15 hover:ring-white/40"}`;

  return (
    <div className="space-y-4">
      <Flash sp={sp} />
      {tabs}

      {canAct && (
        <div className="card text-sm">
          {locked ? (
            <p>
              <Badge tone="amber">Rodada travada</Badge> O mercado reabre quando a rodada for fechada.
            </p>
          ) : waiverOpen ? (
            <p>
              <Badge tone={league.waiverMode === "REPECHAGE" ? "red" : "blue"}>{league.waiverMode === "REPECHAGE" ? "Repescagem de elenco" : "Janela de waiver"}</Badge> Pedidos processados em{" "}
              {formatDate(league.waiverProcessAt)}, em ordem inversa à classificação
              {league.waiverMode === "REPECHAGE" && " (snake: 1 troca por time por volta, invertendo a cada volta)"}.
            </p>
          ) : (
            <p>
              <Badge tone="green">Free agency</Badge> Contratação imediata: quem chegar primeiro leva.
            </p>
          )}
          <p className="mt-1 text-xs text-slate-400">
            Elenco: <b className="text-slate-200">{roster.length}/{game.roster.size}</b>
            {openSpots > 0 ? ` · ${openSpots} vaga(s) livre(s): contrate sem dispensar ninguém` : " · cheio: cada contratação dispensa alguém"}. Respeitando o máximo por posição e por clube.
          </p>
        </div>
      )}
      {!canAct && <p className="card text-sm text-slate-300">Contratações abrem depois do draft. Enquanto isso, dá para explorar todos os jogadores.</p>}

      <div className="card space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="label mb-0 mr-1">Situação</span>
          {OWNERSHIP.map((o) => (
            <Link key={o.value} href={href({ own: o.value === "all" ? undefined : o.value })} className={pill(ownership === o.value)}>
              {o.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="label mb-0 mr-1">Posição</span>
          <Link href={href({ sub: undefined })} className={pill(!subPosition)}>
            Todas
          </Link>
          {SUB_POSITIONS.map((s) => (
            <Link key={s} href={href({ sub: s })} className={pill(subPosition === s)} title={POSITION_LABEL[SUB_PARENT[s]]}>
              {SUB_PLURAL[s]}
            </Link>
          ))}
        </div>
        <form className="flex flex-wrap items-center gap-2">
          {ownership !== "all" && <input type="hidden" name="own" value={ownership} />}
          {subPosition && <input type="hidden" name="sub" value={subPosition} />}
          <select name="club" defaultValue={clubId ?? ""} className="input w-auto" aria-label="Clube">
            <option value="">Todos os clubes</option>
            {clubs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select name="sort" defaultValue={sort} className="input w-auto" aria-label="Ordenar por">
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                Ordenar: {s.label}
              </option>
            ))}
          </select>
          <input name="q" defaultValue={q} placeholder="Buscar jogador" className="input w-44" />
          <button className="btn-ghost">Filtrar</button>
          <span className="ml-auto text-xs text-slate-400">{rows.length} jogador(es)</span>
        </form>
      </div>

      <div className="card overflow-x-auto p-0 sm:p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Jogador</th>
              <th className="hidden sm:table-cell">Clube</th>
              <th className="text-right" title="Média de pontos por jogo">
                Média
              </th>
              <th className="text-right" title={`Projeção para ${current?.name ?? "a rodada"}`}>
                Proj.
              </th>
              <th className="hidden text-right sm:table-cell">Jogos</th>
              <th>Dono</th>
              {canAct && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const free = p.ownerTeamId === null;
              const label = injuryLabel(p);
              return (
                <tr key={p.playerId} className={p.eliminated !== null ? "opacity-50" : ""}>
                  <td>
                    <div className="flex items-center gap-2">
                      <SubPos position={p.position} sub={p.subPosition} />
                      <PlayerAvatar name={p.name} photoUrl={p.photoUrl} position={p.position} className="size-8 text-[10px]" />
                      <div className="min-w-0">
                        <Link href={`/leagues/${league.id}/players/${p.playerId}`} className="block truncate font-semibold hover:text-accent hover:underline">
                          {p.name}
                        </Link>
                        <div className="flex flex-wrap gap-x-2 text-[11px]">
                          <span className="text-slate-400 sm:hidden">{p.club}</span>
                          {label && (
                            <span className={injuryStatus(p) === "DOUBTFUL" ? "text-amber-300" : "text-red-300"} title={p.injurySource === "AUTO" ? (p.injuryNote ?? undefined) : undefined}>
                              ✚ {label}
                            </span>
                          )}
                          {p.eliminated !== null && <span className="text-red-300">clube eliminado</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="hidden sm:table-cell">{p.club}</td>
                  <td className="num text-right text-slate-200">{pts(Math.round(p.avg * 10) / 10)}</td>
                  <td className="text-right">
                    <Rating points={projections.get(p.playerId)?.points ?? 0} />
                  </td>
                  <td className="num hidden text-right text-slate-400 sm:table-cell">{p.games}</td>
                  <td className="text-xs">{p.ownerTeam ?? <span className="text-emerald-300">livre</span>}</td>
                  {canAct && (
                    <td className="text-right">
                      {free && p.eliminated === null && (
                        <details className="relative inline-block text-left">
                          <summary className="btn list-none px-3 py-1 text-xs [&::-webkit-details-marker]:hidden">{waiverOpen ? "Pedir" : "Contratar"}</summary>
                          <form action={action} className="absolute right-0 z-10 mt-1 flex w-72 flex-col gap-2 rounded-xl bg-night-850 p-3 shadow-2xl ring-1 ring-white/15">
                            <input type="hidden" name="leagueId" value={league.id} />
                            <input type="hidden" name="addPlayerId" value={p.playerId} />
                            <label className="label mb-0" htmlFor={`drop-${p.playerId}`}>
                              Dispensar
                            </label>
                            <select id={`drop-${p.playerId}`} name="dropPlayerId" className="input py-1 text-xs" required={openSpots === 0}>
                              {openSpots > 0 && <option value="">Sem dispensa (vaga livre)</option>}
                              {dropOptions(p.position).map((r) => (
                                <option key={r.playerId} value={r.playerId}>
                                  {POSITION_LABEL[r.position]} · {r.name}
                                  {r.eliminated !== null ? " (eliminado)" : ""}
                                </option>
                              ))}
                            </select>
                            <button className="btn px-3 py-1 text-xs" disabled={locked}>
                              {waiverOpen ? "Fazer pedido" : "Confirmar contratação"}
                            </button>
                          </form>
                        </details>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  Nenhum jogador com esses filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canAct && (
        <>
          <div className="card">
            <h2 className="mb-1 text-lg font-bold uppercase">Dispensar jogador</h2>
            <p className="mb-3 text-xs text-slate-400">Libera uma vaga no elenco; o jogador fica livre para qualquer time.</p>
            <form action={dropPlayerAction} className="flex flex-wrap gap-2">
              <input type="hidden" name="leagueId" value={league.id} />
              <select name="playerId" className="input w-auto" required aria-label="Jogador a dispensar">
                {[...roster]
                  .sort((a, b) => a.total - b.total)
                  .map((r) => (
                    <option key={r.playerId} value={r.playerId}>
                      {POSITION_LABEL[r.position]} · {r.name} ({pts(r.games ? r.total / r.games : 0)} de média)
                    </option>
                  ))}
              </select>
              <button className="btn-ghost" disabled={locked}>
                Dispensar
              </button>
            </form>
          </div>

          <div className="card">
            <h2 className="mb-3 text-lg font-bold uppercase">Meus pedidos de waiver</h2>
            {claims.length === 0 ? (
              <p className="text-sm text-slate-400">Nenhum pedido.</p>
            ) : (
              <ul className="divide-y divide-white/5 text-sm">
                {claims.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
                    <Badge tone={CLAIM_TONE[c.status]}>{CLAIM_LABEL[c.status]}</Badge>
                    <span className="flex-1">
                      #{c.preference} · entra <b>{c.addName}</b>
                      {c.dropName ? `, sai ${c.dropName}` : " (vaga livre)"}
                      {c.failReason && <span className="block text-xs text-red-300">{c.failReason}</span>}
                    </span>
                    {c.status === "PENDING" && (
                      <form action={cancelClaimAction}>
                        <input type="hidden" name="leagueId" value={league.id} />
                        <input type="hidden" name="claimId" value={c.id} />
                        <button className="btn-ghost px-2 py-1 text-xs">Cancelar</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

