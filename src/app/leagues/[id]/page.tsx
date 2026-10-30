import Link from "next/link";
import { game } from "@config/game";
import { startDraftAction } from "@/app/actions";
import { injuryLabel, injuryStatus } from "@/domain/injuries";
import { teamOf } from "@/server/leagues";
import { projectRound } from "@/server/projections";
import { leagueStandings } from "@/server/season";
import { teamRoundScore } from "@/server/teamScore";
import { PlayerAvatar } from "@/web/PlayerAvatar";
import { leagueTeams, roundMatchups, roundsState, rosterView, searchPlayers } from "@/web/queries";
import { requireMember } from "@/web/session";
import { Badge, Flash, formatDate, pts, Rating, SubPos, type SearchParams } from "@/web/ui";

/** Visão geral em "bento": tiles de vidro com o que importa agora. */
export default async function LeagueHome({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { league, user, isCommissioner, db } = await requireMember(Number(id));
  const teams = await leagueTeams(db, league.id);
  const { all, current, locked } = await roundsState(db, new Date());
  const startRound = all.find((r) => r.order === league.startRound);
  const base = `/leagues/${league.id}`;
  const team = league.status === "ACTIVE" ? await teamOf(db, league.id, user.id) : null;
  const nameOf = (teamId: number) => teams.find((t) => t.id === teamId)?.name ?? "—";

  const [standings, roster, score, projections, matchups, freeTop] = await Promise.all([
    league.status === "ACTIVE" ? leagueStandings(db, league.id) : Promise.resolve([]),
    team ? rosterView(db, team.id) : Promise.resolve([]),
    team && current ? teamRoundScore(db, team.id, current.order) : Promise.resolve(null),
    team && current ? projectRound(db, current.order) : Promise.resolve(new Map()),
    team && current ? roundMatchups(db, league.id, current.order) : Promise.resolve([]),
    team ? searchPlayers(db, { leagueId: league.id, onlyFree: true, sort: "avg", limit: 200 }) : Promise.resolve([]),
  ]);
  const mine = matchups.find((m) => m.homeTeamId === team?.id || m.awayTeamId === team?.id);
  const rival = mine ? (mine.homeTeamId === team?.id ? mine.awayTeamId : mine.homeTeamId) : null;
  const rivalScore = rival && current ? await teamRoundScore(db, rival, current.order) : null;
  const projectedStarters = Math.round(roster.filter((p) => p.slot === "STARTER").reduce((s, p) => s + (projections.get(p.playerId)?.points ?? 0), 0) * 10) / 10;
  const alerts = roster.filter((p) => injuryStatus(p) !== "FIT" || p.eliminated !== null);
  const picks = [...freeTop].filter((p) => p.eliminated === null).sort((a, b) => (projections.get(b.playerId)?.points ?? 0) - (projections.get(a.playerId)?.points ?? 0)).slice(0, 5);

  return (
    <div className="space-y-4">
      <Flash sp={sp} />

      {league.status === "SETUP" && (
        <div className="card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-300">Convide os participantes com o código abaixo. O draft precisa de pelo menos {game.league.minTeams} times.</p>
          {isCommissioner && (
            <form action={startDraftAction}>
              <input type="hidden" name="leagueId" value={league.id} />
              <button className="btn-accent" disabled={teams.length < game.league.minTeams}>
                Iniciar draft
              </button>
            </form>
          )}
        </div>
      )}
      {league.status === "DRAFTING" && (
        <Link href={`${base}/draft`} className="card card-link flex items-center justify-between gap-3 !bg-amber-500/10 ring-amber-400/30">
          <span className="flex items-center gap-3">
            <span className="size-2.5 animate-pulse rounded-full bg-amber-300" />
            <span className="font-display text-xl font-bold uppercase text-amber-200">O draft está acontecendo agora</span>
          </span>
          <span className="btn-accent">Entrar na sala →</span>
        </Link>
      )}

      <div className="grid auto-rows-min gap-4 md:grid-cols-6">
        {/* Meu time: tile grande */}
        <Link href={`${base}/team`} className="card card-link md:col-span-3 md:row-span-2">
          <div className="pointer-events-none absolute -right-8 -top-8 size-40 rounded-full bg-accent/15 blur-3xl" />
          <p className="tile-label">⚽ Meu time</p>
          {team ? (
            <>
              <h2 className="mt-1 truncate text-2xl font-extrabold uppercase">{team.name}</h2>
              <div className="mt-4 flex items-end gap-6">
                <div>
                  <p className="tile-label">Pontos na rodada</p>
                  <p className="tile-value text-accent">{pts(score?.points ?? 0)}</p>
                </div>
                <div>
                  <p className="tile-label">Projeção</p>
                  <p className="tile-value text-slate-200">{pts(projectedStarters)}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <Badge tone="blue">{team.formation}</Badge>
                <Badge>
                  Elenco {roster.length}/{game.roster.size}
                </Badge>
                {team.managerId ? <Badge tone="green">Técnico contratado</Badge> : <Badge tone="amber">Sem técnico</Badge>}
              </div>
              <div className="mt-4 flex -space-x-2">
                {roster
                  .filter((p) => p.slot === "STARTER")
                  .slice(0, 11)
                  .map((p) => (
                    <PlayerAvatar key={p.playerId} name={p.name} photoUrl={p.photoUrl} position={p.position} className="size-9 text-[10px] ring-night-900" />
                  ))}
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-400">Seu elenco aparece aqui depois do draft.</p>
          )}
        </Link>

        {/* Rodada */}
        <div className="card md:col-span-3">
          <p className="tile-label">🗓 Rodada vigente</p>
          <p className="mt-1 font-display text-2xl font-bold uppercase leading-tight">{current?.name ?? "—"}</p>
          <p className="mt-2 text-xs text-slate-400">
            {locked ? <Badge tone="amber">🔒 Escalações travadas</Badge> : `Trava em ${formatDate(current?.firstKickoff)}`}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Liga começa em {startRound?.name ?? `rodada ${league.startRound}`} · regular até a R{game.season.regularSeasonLastRound}, playoffs (top {game.season.playoffTeams}) nas oitavas e quartas.
          </p>
        </div>

        {/* Confronto */}
        <Link href={`${base}/matchup`} className="card card-link md:col-span-3">
          <p className="tile-label">🆚 Meu confronto</p>
          {mine && team && rival ? (
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{team.name}</p>
                <p className="num text-3xl font-extrabold text-accent">{pts(score?.points ?? 0)}</p>
              </div>
              <span className="text-xs text-slate-500">x</span>
              <div className="min-w-0 text-right">
                <p className="truncate text-sm font-semibold">{nameOf(rival)}</p>
                <p className="num text-3xl font-extrabold">{pts(rivalScore?.points ?? 0)}</p>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-400">Sem confronto na rodada.</p>
          )}
        </Link>

        {/* Classificação */}
        <div className="card md:col-span-2">
          <div className="flex items-center justify-between">
            <p className="tile-label">🏆 Classificação</p>
            <Link href={`${base}/standings`} className="text-xs text-accent hover:underline">
              ver tudo
            </Link>
          </div>
          {standings.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">Começa depois da primeira rodada fechada.</p>
          ) : (
            <ol className="mt-2 space-y-1 text-sm">
              {standings.slice(0, 5).map((row, i) => (
                <li key={row.teamId} className="flex items-center gap-2">
                  <span className="num w-5 text-slate-500">{i + 1}</span>
                  <span className={`min-w-0 flex-1 truncate ${row.teamId === team?.id ? "font-bold text-accent" : ""}`}>{nameOf(row.teamId)}</span>
                  <span className="num text-slate-300">{row.wins}V</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Alertas */}
        <div className="card md:col-span-2">
          <p className="tile-label">✚ Alertas do elenco</p>
          {alerts.length === 0 ? (
            <p className="mt-2 text-sm text-emerald-300">Elenco saudável.</p>
          ) : (
            <ul className="mt-2 space-y-1.5 text-sm">
              {alerts.slice(0, 5).map((p) => (
                <li key={p.playerId} className="flex items-center gap-2">
                  <SubPos position={p.position} sub={p.subPosition} />
                  <Link href={`${base}/players/${p.playerId}`} className="min-w-0 flex-1 truncate hover:text-accent">
                    {p.name}
                  </Link>
                  <span className={`text-[11px] ${injuryStatus(p) === "DOUBTFUL" ? "text-amber-300" : "text-red-300"}`}>{injuryLabel(p) ?? "clube eliminado"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Melhores livres */}
        <div className="card md:col-span-2">
          <div className="flex items-center justify-between">
            <p className="tile-label">🔥 Melhores livres (proj.)</p>
            <Link href={`${base}/market?own=free&sort=proj`} className="text-xs text-accent hover:underline">
              mercado
            </Link>
          </div>
          {picks.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">—</p>
          ) : (
            <ul className="mt-2 space-y-1.5 text-sm">
              {picks.map((p) => (
                <li key={p.playerId} className="flex items-center gap-2">
                  <PlayerAvatar name={p.name} photoUrl={p.photoUrl} position={p.position} className="size-6 text-[8px]" />
                  <Link href={`${base}/players/${p.playerId}`} className="min-w-0 flex-1 truncate hover:text-accent">
                    {p.name}
                  </Link>
                  <Rating points={projections.get(p.playerId)?.points ?? 0} className="!min-w-9 !text-xs" />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Convite + times */}
        <div className="card md:col-span-2">
          <p className="tile-label">🔑 Código de convite</p>
          <p className="mt-1 font-mono text-3xl font-bold tracking-[0.3em] text-accent">{league.inviteCode}</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full bg-linear-to-r from-brand-500 to-accent" style={{ width: `${Math.round((teams.length / league.maxTeams) * 100)}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-slate-400">
            {teams.length}/{league.maxTeams} times
          </p>
        </div>
        <div className="card md:col-span-4">
          <p className="tile-label">👥 Times</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {teams.map((t, i) => (
              <li key={t.id} className="flex items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2 ring-1 ring-white/5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl font-display text-lg font-bold text-night-950" style={{ background: `hsl(${(i * 47 + 200) % 360} 80% 70%)` }}>
                  {t.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{t.name}</span>
                  <span className="block truncate text-xs text-slate-400">{t.owner}</span>
                </span>
                {t.userId === league.commissionerId && <Badge tone="accent">Comissário</Badge>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
