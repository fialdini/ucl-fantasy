import Link from "next/link";
import { notFound } from "next/navigation";
import { setManagerAction } from "@/app/actions";
import { teamOf } from "@/server/leagues";
import { managerDetail } from "@/server/manager";
import { roundsState } from "@/web/queries";
import { requireMember } from "@/web/session";
import { PlayerAvatar } from "@/web/PlayerAvatar";
import { Badge, Delta, Empty, Flash, formatDate, pts, Rating, SectionTitle, type SearchParams } from "@/web/ui";

export default async function ManagerPage({ params, searchParams }: { params: Promise<{ id: string; coachId: string }>; searchParams: SearchParams }) {
  const [{ id, coachId }, sp] = await Promise.all([params, searchParams]);
  const { league, user, db } = await requireMember(Number(id));
  const detail = await managerDetail(db, league.id, Number(coachId));
  if (!detail) notFound();
  const { coach, club, owner, season, upcoming, totals } = detail;
  const team = await teamOf(db, league.id, user.id);
  const { locked } = await roundsState(db, new Date());
  const mine = !!team && owner?.teamId === team.id;
  const canHire = !!team && league.status === "ACTIVE" && !owner && club.eliminatedAfterRound === null;
  const here = `/leagues/${league.id}/managers/${coach.id}`;
  const history = season.filter((s) => s.match.status === "FINISHED");

  return (
    <div className="space-y-4">
      <Flash sp={sp} />
      <Link href={`/leagues/${league.id}/market?view=coaches`} className="text-sm text-slate-400 hover:text-white">
        ← Técnicos
      </Link>
      <div className="card flex flex-wrap items-center gap-4">
        <PlayerAvatar name={coach.name} photoUrl={coach.photoUrl} position="GK" className="size-20 text-2xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-block rounded-md bg-violet-400/15 px-2 py-0.5 text-[10px] font-bold tracking-wider text-violet-300 ring-1 ring-violet-400/30">TÉCNICO</span>
            {club.eliminatedAfterRound !== null && <Badge tone="red">Clube eliminado</Badge>}
            {owner ? <Badge tone={mine ? "green" : "slate"}>{mine ? "Seu técnico" : `Time: ${owner.teamName}`}</Badge> : <Badge tone="green">Livre</Badge>}
          </div>
          <h2 className="mt-1 text-3xl font-extrabold uppercase leading-none">{coach.name}</h2>
          <p className="mt-1 text-sm text-slate-400">{club.name}</p>
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="label">Total</p>
            <p className="num text-2xl font-bold">{pts(totals.points)}</p>
          </div>
          <div>
            <p className="label">Média</p>
            <p className="num text-2xl font-bold text-accent">{pts(totals.avg)}</p>
          </div>
          <div>
            <p className="label">Jogos</p>
            <p className="num text-2xl font-bold">{totals.games}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {canHire && (
            <form action={setManagerAction}>
              <input type="hidden" name="leagueId" value={league.id} />
              <input type="hidden" name="coachId" value={coach.id} />
              <input type="hidden" name="returnTo" value={here} />
              <button className="btn-accent" disabled={locked}>
                {locked ? "Rodada travada" : "Contratar"}
              </button>
            </form>
          )}
          {mine && (
            <form action={setManagerAction}>
              <input type="hidden" name="leagueId" value={league.id} />
              <input type="hidden" name="returnTo" value={here} />
              <button className="btn-ghost" disabled={locked}>
                Dispensar
              </button>
            </form>
          )}
        </div>
      </div>

      <section className="card">
        <SectionTitle>Histórico de partidas</SectionTitle>
        {history.length === 0 ? (
          <Empty>O clube ainda não jogou.</Empty>
        ) : (
          <ul className="divide-y divide-white/5 text-sm">
            {history.map((s) => (
              <li key={s.round.order} className="py-2">
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3">
                    <span className="num w-8 text-slate-500">R{s.round.order}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {s.home ? "vs" : "@"} {s.opponent?.name}
                      <span className="ml-2 text-slate-400">
                        {s.match.homeGoals}–{s.match.awayGoals}
                      </span>
                    </span>
                    {s.score?.status === "SCORED" ? <Rating points={s.score.points} /> : <span className="text-xs text-amber-300">aguardando dados</span>}
                    <span className="text-slate-500 transition group-open:rotate-90" aria-hidden>
                      ›
                    </span>
                  </summary>
                  {s.score && s.score.breakdown.length > 0 && (
                    <ul className="ml-11 mt-2 space-y-0.5 border-l border-white/10 pl-3 text-xs text-slate-300">
                      {s.score.breakdown.map((b, i) => (
                        <li key={i} className="flex justify-between gap-2">
                          <span>{b.label}</span>
                          <Delta points={b.points} />
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <SectionTitle>Próximos jogos</SectionTitle>
        {upcoming.length === 0 ? (
          <Empty>Sem jogos marcados (clube eliminado ou temporada encerrada).</Empty>
        ) : (
          <ul className="divide-y divide-white/5 text-sm">
            {upcoming.map((s) => (
              <li key={s.round.order} className="flex items-center gap-3 py-2">
                <span className="num w-8 text-slate-500">R{s.round.order}</span>
                <span className="min-w-0 flex-1 truncate">
                  {s.home ? "vs" : "@"} {s.opponent?.name}
                </span>
                <span className="text-xs text-slate-400">{formatDate(s.match.kickoff)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
