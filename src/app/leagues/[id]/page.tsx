import Link from "next/link";
import { game } from "@config/game";
import { startDraftAction } from "@/app/actions";
import { leagueTeams, roundsState } from "@/web/queries";
import { requireMember } from "@/web/session";
import { Badge, Flash, formatDate, type SearchParams } from "@/web/ui";

export default async function LeagueHome({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { league, isCommissioner, db } = await requireMember(Number(id));
  const teams = await leagueTeams(db, league.id);
  const { all, current, locked } = await roundsState(db, new Date());
  const startRound = all.find((r) => r.order === league.startRound);

  return (
    <div className="space-y-4">
      <Flash sp={sp} />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card">
          <p className="label">Código de convite</p>
          <p className="font-mono text-2xl font-bold tracking-widest">{league.inviteCode}</p>
          <p className="mt-1 text-xs text-slate-500">
            {teams.length}/{league.maxTeams} times
          </p>
        </div>
        <div className="card">
          <p className="label">Rodada vigente</p>
          <p className="font-semibold">{current?.name ?? "—"}</p>
          <p className="mt-1 text-xs text-slate-500">
            {locked ? <Badge tone="amber">Escalações travadas</Badge> : `Trava em ${formatDate(current?.firstKickoff)}`}
          </p>
        </div>
        <div className="card">
          <p className="label">Liga começa em</p>
          <p className="font-semibold">{startRound?.name ?? `Rodada ${league.startRound}`}</p>
          <p className="mt-1 text-xs text-slate-500">
            Temporada regular até a rodada {game.season.regularSeasonLastRound}; playoffs (top {game.season.playoffTeams}) nas
            oitavas e quartas.
          </p>
        </div>
      </div>

      {league.status === "SETUP" && (
        <div className="card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-600">
            Convide os participantes com o código acima. O draft precisa de pelo menos {game.league.minTeams} times.
          </p>
          {isCommissioner && (
            <form action={startDraftAction}>
              <input type="hidden" name="leagueId" value={league.id} />
              <button className="btn" disabled={teams.length < game.league.minTeams}>
                Iniciar draft
              </button>
            </form>
          )}
        </div>
      )}
      {league.status === "DRAFTING" && (
        <Link href={`/leagues/${league.id}/draft`} className="card block bg-amber-50 font-semibold text-amber-900 ring-amber-200">
          O draft está acontecendo agora → entrar na sala
        </Link>
      )}

      <div className="card">
        <h2 className="mb-2 font-semibold">Times</h2>
        <ul className="divide-y divide-slate-100 text-sm">
          {teams.map((t) => (
            <li key={t.id} className="flex justify-between py-2">
              <span className="font-medium">{t.name}</span>
              <span className="text-slate-500">
                {t.owner}
                {t.userId === league.commissionerId && " · comissário"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
