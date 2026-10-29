import Link from "next/link";
import { game } from "@config/game";
import { setLineupAction } from "@/app/actions";
import { POSITIONS } from "@/domain/roster";
import { teamOf } from "@/server/leagues";
import { teamRoundScore } from "@/server/teamScore";
import { roundsState, rosterView } from "@/web/queries";
import { requireMember } from "@/web/session";
import { Badge, Flash, formatDate, PlayerStatus, Pos, POSITION_LABEL, type SearchParams } from "@/web/ui";

export default async function TeamPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { league, user, db } = await requireMember(Number(id));
  const team = await teamOf(db, league.id, user.id);
  if (!team) return <p className="card">Você não tem time nesta liga.</p>;
  const roster = await rosterView(db, team.id);
  if (roster.length === 0) {
    return (
      <p className="card text-sm">
        Seu elenco será montado no <Link href={`/leagues/${league.id}/draft`} className="font-semibold text-brand-700">draft</Link>.
      </p>
    );
  }
  const { current, locked } = await roundsState(db, new Date());
  const score = current ? await teamRoundScore(db, team.id, current.order) : null;
  const lineByPlayer = new Map(score?.lines.map((l) => [l.playerId, l]) ?? []);
  const sorted = [...roster].sort(
    (a, b) => (a.slot === b.slot ? 0 : a.slot === "STARTER" ? -1 : 1) || POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position),
  );
  const formation = POSITIONS.map((p) => `${game.roster.starters[p]} ${POSITION_LABEL[p]}`).join(" · ");

  return (
    <div className="space-y-4">
      <Flash sp={sp} />
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{team.name}</h2>
          <p className="text-sm text-slate-500">
            {current?.name} · {locked ? "escalação travada até o fechamento da rodada" : `trava em ${formatDate(current?.firstKickoff)}`}
          </p>
        </div>
        <div className="text-right">
          <p className="label">Pontos na rodada</p>
          <p className="text-2xl font-bold tabular-nums">{score?.points ?? 0}</p>
          {score?.awaitingData && <Badge tone="amber">Aguardando dados oficiais</Badge>}
        </div>
      </div>

      <form action={setLineupAction} className="card">
        <input type="hidden" name="leagueId" value={league.id} />
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-600">
            Marque os 11 titulares ({formation}). Os demais ficam no banco — sem substituição automática.
          </p>
          <button className="btn" disabled={locked}>
            Salvar escalação
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th className="w-10">Tit.</th>
              <th>Jogador</th>
              <th className="hidden sm:table-cell">Clube</th>
              <th className="text-right">Rodada</th>
              <th className="hidden text-right sm:table-cell">Total</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const line = lineByPlayer.get(p.playerId);
              const warning = p.eliminated !== null ? "Clube eliminado" : !p.active ? "Fora da lista UEFA" : null;
              return (
                <tr key={p.playerId} className={p.slot === "BENCH" ? "bg-slate-50" : ""}>
                  <td>
                    <input
                      type="checkbox"
                      name="starter"
                      value={p.playerId}
                      defaultChecked={p.slot === "STARTER"}
                      disabled={locked}
                      className="size-4 accent-brand-700"
                      aria-label={`Titular: ${p.name}`}
                    />
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <Pos position={p.position} />
                      <span className="font-medium">{p.name}</span>
                    </div>
                    {warning && <p className="mt-0.5 text-xs text-red-700">{warning} — troque no mercado</p>}
                    {line && <PlayerStatus status={line.status} />}
                  </td>
                  <td className="hidden sm:table-cell">{p.club}</td>
                  <td className="text-right tabular-nums">{line?.status === "SCORED" ? line.points : "–"}</td>
                  <td className="hidden text-right tabular-nums sm:table-cell">{p.total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </form>
    </div>
  );
}
