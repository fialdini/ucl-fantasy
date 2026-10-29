import { cancelClaimAction, freeAgentAction, waiverClaimAction } from "@/app/actions";
import { POSITIONS } from "@/domain/roster";
import type { Position } from "@/domain/types";
import { teamOf } from "@/server/leagues";
import { roundsState, rosterView, searchPlayers, teamClaims } from "@/web/queries";
import { requireMember } from "@/web/session";
import { Badge, Flash, formatDate, param, Pos, POSITION_LABEL, type SearchParams } from "@/web/ui";

const CLAIM_TONE = { PENDING: "blue", SUCCEEDED: "green", FAILED: "red", CANCELLED: "slate" } as const;
const CLAIM_LABEL = { PENDING: "Pendente", SUCCEEDED: "Atendido", FAILED: "Recusado", CANCELLED: "Cancelado" };

export default async function MarketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { league, user, db } = await requireMember(Number(id));
  const team = await teamOf(db, league.id, user.id);
  if (!team || league.status !== "ACTIVE") return <p className="card text-sm">O mercado abre depois do draft.</p>;

  const position = (POSITIONS as readonly string[]).includes(param(sp, "position") ?? "") ? (param(sp, "position") as Position) : undefined;
  const q = param(sp, "q") || undefined;
  const [{ locked }, roster, free, claims] = await Promise.all([
    roundsState(db, new Date()),
    rosterView(db, team.id),
    searchPlayers(db, { leagueId: league.id, onlyFree: true, position, q, limit: 60 }),
    teamClaims(db, team.id),
  ]);
  const waiverOpen = league.waiverProcessAt !== null;
  const action = waiverOpen ? waiverClaimAction : freeAgentAction;

  return (
    <div className="space-y-4">
      <Flash sp={sp} />
      <div className="card text-sm">
        {locked ? (
          <p>
            <Badge tone="amber">Rodada travada</Badge> O mercado reabre quando a rodada for fechada.
          </p>
        ) : waiverOpen ? (
          <p>
            <Badge tone={league.waiverMode === "REPECHAGE" ? "red" : "blue"}>
              {league.waiverMode === "REPECHAGE" ? "Repescagem de elenco" : "Janela de waiver"}
            </Badge>{" "}
            Pedidos processados em {formatDate(league.waiverProcessAt)}, em ordem inversa à classificação
            {league.waiverMode === "REPECHAGE" && " (snake: 1 troca por time por volta, invertendo a cada volta)"}.
          </p>
        ) : (
          <p>
            <Badge tone="green">Free agency</Badge> Contratação imediata: quem chegar primeiro leva.
          </p>
        )}
        <p className="mt-1 text-xs text-slate-500">Trocas são sempre da mesma posição e respeitam o limite de jogadores por clube.</p>
      </div>

      <form className="flex flex-wrap gap-2">
        <select name="position" defaultValue={position ?? ""} className="input w-auto">
          <option value="">Todas as posições</option>
          {POSITIONS.map((p) => (
            <option key={p} value={p}>
              {POSITION_LABEL[p]}
            </option>
          ))}
        </select>
        <input name="q" defaultValue={q} placeholder="Buscar jogador" className="input w-44" />
        <button className="btn-ghost">Filtrar</button>
      </form>

      <div className="card overflow-x-auto">
        <h2 className="mb-2 font-semibold">Jogadores livres</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Jogador</th>
              <th className="text-right">Pts</th>
              <th>Dispensar</th>
            </tr>
          </thead>
          <tbody>
            {free
              .filter((p) => p.eliminated === null)
              .map((p) => (
                <tr key={p.playerId}>
                  <td>
                    <div className="flex items-center gap-2">
                      <Pos position={p.position} />
                      <span className="font-medium">{p.name}</span>
                    </div>
                    <span className="text-xs text-slate-500">
                      {p.club} · média {p.avg.toFixed(1)}
                    </span>
                  </td>
                  <td className="text-right tabular-nums">{p.total}</td>
                  <td>
                    <form action={action} className="flex gap-1">
                      <input type="hidden" name="leagueId" value={league.id} />
                      <input type="hidden" name="addPlayerId" value={p.playerId} />
                      <select name="dropPlayerId" className="input w-36 py-1 text-xs" required>
                        {roster
                          .filter((r) => r.position === p.position)
                          .sort((a, b) => Number(b.eliminated !== null) - Number(a.eliminated !== null) || a.total - b.total)
                          .map((r) => (
                            <option key={r.playerId} value={r.playerId}>
                              {r.name}
                              {r.eliminated !== null ? " (eliminado)" : ""}
                            </option>
                          ))}
                      </select>
                      <button className="btn px-2 py-1 text-xs" disabled={locked}>
                        {waiverOpen ? "Pedir" : "Contratar"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 className="mb-2 font-semibold">Meus pedidos de waiver</h2>
        {claims.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum pedido.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {claims.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
                <Badge tone={CLAIM_TONE[c.status]}>{CLAIM_LABEL[c.status]}</Badge>
                <span className="flex-1">
                  #{c.preference} · entra <b>{c.addName}</b>, sai {c.dropName}
                  {c.failReason && <span className="block text-xs text-red-700">{c.failReason}</span>}
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
    </div>
  );
}
