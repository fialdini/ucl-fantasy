import { redirect } from "next/navigation";
import { advanceMockWeekAction, recalcPointsAction, reprocessRoundAction, syncNowAction } from "@/app/actions";
import { providerName } from "@/providers";
import { clubNames, pendingStatsMatches, recentSyncLogs, roundsState } from "@/web/queries";
import { requireMember } from "@/web/session";
import { Badge, Flash, formatDate, type SearchParams } from "@/web/ui";

const TONE = { SUCCESS: "green", PARTIAL: "amber", ERROR: "red", RUNNING: "blue" } as const;

export default async function AdminPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { league, isCommissioner, db } = await requireMember(Number(id));
  if (!isCommissioner) redirect(`/leagues/${league.id}`);
  const [logs, pending, { all, current }, clubs] = await Promise.all([
    recentSyncLogs(db),
    pendingStatsMatches(db),
    roundsState(db, new Date()),
    clubNames(db),
  ]);
  const provider = providerName();
  const hidden = <input type="hidden" name="leagueId" value={league.id} />;

  return (
    <div className="space-y-4">
      <Flash sp={sp} />
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Dados</h2>
          <Badge tone={provider === "mock" ? "amber" : "green"}>Fonte: {provider}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={syncNowAction}>
            {hidden}
            <button className="btn">Sincronizar agora</button>
          </form>
          <form action={reprocessRoundAction} className="flex gap-2">
            {hidden}
            <select name="round" className="input w-auto" defaultValue={current?.order ?? 1}>
              {all.map((r) => (
                <option key={r.order} value={r.order}>
                  {r.name}
                </option>
              ))}
            </select>
            <button className="btn">Reprocessar rodada</button>
          </form>
          <form action={recalcPointsAction}>
            {hidden}
            <button className="btn-ghost" title="Recalcula com a tabela de pontuação atual, sem chamar a API">
              Recalcular pontos (sem API)
            </button>
          </form>
          {provider === "mock" && (
            <form action={advanceMockWeekAction}>
              {hidden}
              <button className="btn-ghost">Mock: avançar 1 semana</button>
            </form>
          )}
        </div>
        <p className="text-xs text-slate-500">
          O job agendado (/api/cron) roda isso automaticamente. Reprocessar busca de novo na fonte e recalcula, sem fechar a
          rodada.
        </p>
      </div>

      <div className="card">
        <h2 className="mb-2 font-semibold">Partidas aguardando dados oficiais ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma.</p>
        ) : (
          <ul className="text-sm">
            {pending.map((m) => (
              <li key={m.id} className="flex justify-between border-b border-slate-100 py-1">
                <span>
                  {clubs.get(m.homeClubId)?.shortName} × {clubs.get(m.awayClubId)?.shortName}
                </span>
                <span className="text-amber-700">{m.statsError ?? "sem estatística"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card overflow-x-auto">
        <h2 className="mb-2 font-semibold">Log de sincronização</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Job</th>
              <th>Status</th>
              <th className="text-right">Req.</th>
              <th>Mensagem</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap">{formatDate(l.startedAt)}</td>
                <td className="whitespace-nowrap">{l.job}</td>
                <td>
                  <Badge tone={TONE[l.status]}>{l.status}</Badge>
                </td>
                <td className="text-right">{l.requests}</td>
                <td className="min-w-48 text-xs text-slate-600">{l.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
