import Link from "next/link";
import { game } from "@config/game";
import { teamOf } from "@/server/leagues";
import { projectRound, type PlayerProjection } from "@/server/projections";
import { teamRoundScore, type TeamRoundScore } from "@/server/teamScore";
import { clubNames, leagueTeams, roundMatchups, roundsState } from "@/web/queries";
import { requireMember } from "@/web/session";
import { Badge, Delta, Empty, param, PlayerStatus, Pos, pts, type SearchParams } from "@/web/ui";

const KIND = { REGULAR: "Temporada regular", SEMI: "Semifinal (oitavas, ida + volta)", FINAL: "Final (quartas, ida + volta)" };

export default async function MatchupPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { league, user, db } = await requireMember(Number(id));
  const { all, current } = await roundsState(db, new Date());
  const roundOrder = Number(param(sp, "round") ?? current?.order ?? league.startRound);
  const round = all.find((r) => r.order === roundOrder);
  const [matchups, teams, myTeam, clubs] = await Promise.all([
    roundMatchups(db, league.id, roundOrder),
    leagueTeams(db, league.id),
    teamOf(db, league.id, user.id),
    clubNames(db),
  ]);
  const name = (teamId: number) => teams.find((t) => t.id === teamId)?.name ?? "—";
  const owner = (teamId: number) => teams.find((t) => t.id === teamId)?.owner ?? "";
  const selectedId = Number(param(sp, "m") ?? matchups.find((m) => m.homeTeamId === myTeam?.id || m.awayTeamId === myTeam?.id)?.id ?? matchups[0]?.id);
  const selected = matchups.find((m) => m.id === selectedId);
  const [home, away] = selected
    ? await Promise.all([teamRoundScore(db, selected.homeTeamId, roundOrder), teamRoundScore(db, selected.awayTeamId, roundOrder)])
    : [null, null];
  const projections = selected ? await projectRound(db, roundOrder) : new Map<number, PlayerProjection>();
  /** Placar projetado: quem já pontuou conta o real; quem ainda vai jogar, a projeção. */
  const projectedTotal = (score: TeamRoundScore) =>
    Math.round(
      score.lines
        .filter((l) => l.slot === "STARTER")
        .reduce((s, l) => s + (l.status === "SCORED" ? l.points : ["NOT_STARTED", "LIVE", "AWAITING_DATA"].includes(l.status) ? (projections.get(l.playerId)?.points ?? 0) : 0), 0) * 10,
    ) / 10;
  const rounds = all.filter((r) => r.order >= league.startRound && r.order <= game.season.playoffs[1].toRound);

  return (
    <div className="space-y-4">
      <nav className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]">
        <ul className="flex w-max gap-1.5 text-xs">
          {rounds.map((r) => (
            <li key={r.order}>
              <Link
                href={`?round=${r.order}`}
                className={`num block rounded-full px-3.5 py-1.5 text-sm font-bold transition ${
                  r.order === roundOrder
                    ? "bg-accent text-night-950 shadow-md shadow-accent/30"
                    : r.closedAt
                      ? "bg-white/5 text-slate-400 ring-1 ring-white/10 hover:text-white"
                      : "bg-night-900 text-slate-300 ring-1 ring-white/10 hover:ring-white/30"
                }`}
              >
                R{r.order}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {selected && home && away && (
        <div className="card relative overflow-hidden p-0 sm:p-0">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_12rem_at_50%_0%,rgb(79_107_255/0.25),transparent)]" />
          <div className="relative px-4 pt-4 text-center sm:px-6">
            <p className="eyebrow">{round?.name}</p>
            <p className="text-xs text-slate-400">{KIND[selected.kind]}</p>
          </div>
          <div className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-5 sm:gap-6 sm:px-8">
            <ScoreSide name={name(selected.homeTeamId)} owner={owner(selected.homeTeamId)} points={home.points} projected={selected.status === "FINAL" ? null : projectedTotal(home)} winning={home.points > away.points} />
            <span className="font-display text-xl font-bold text-slate-500">×</span>
            <ScoreSide name={name(selected.awayTeamId)} owner={owner(selected.awayTeamId)} points={away.points} projected={selected.status === "FINAL" ? null : projectedTotal(away)} winning={away.points > home.points} right />
          </div>
          <div className="relative flex justify-center pb-4">
            {selected.status === "FINAL" ? (
              <Badge tone="green">Final</Badge>
            ) : home.awaitingData || away.awaitingData ? (
              <Badge tone="amber">Parcial · aguardando dados oficiais</Badge>
            ) : (
              <Badge tone="blue">{selected.status === "PARTIAL" ? "● Parcial" : "A jogar"}</Badge>
            )}
          </div>
        </div>
      )}

      {matchups.length === 0 ? (
        <Empty>Nenhum confronto nesta rodada.</Empty>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {matchups.map((m) => {
            const mine = m.homeTeamId === myTeam?.id || m.awayTeamId === myTeam?.id;
            return (
              <li key={m.id}>
                <Link
                  href={`?round=${roundOrder}&m=${m.id}`}
                  className={`card card-link flex items-center justify-between gap-2 p-3 text-sm sm:p-3 ${m.id === selectedId ? "ring-2 ring-accent/70" : ""}`}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {mine && <span className="mr-1 text-accent">●</span>}
                    {name(m.homeTeamId)}
                  </span>
                  <span className="num rounded-lg bg-night-950/70 px-2 py-0.5 text-base font-bold">
                    {pts(m.homePoints ?? 0)} – {pts(m.awayPoints ?? 0)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-right font-medium">{name(m.awayTeamId)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {selected && home && away && (
        <div className="grid gap-4 md:grid-cols-2">
          <TeamColumn title={name(selected.homeTeamId)} score={home} clubs={clubs} projections={projections} />
          <TeamColumn title={name(selected.awayTeamId)} score={away} clubs={clubs} projections={projections} />
        </div>
      )}
    </div>
  );
}

function ScoreSide({ name, owner, points, projected, winning, right = false }: { name: string; owner: string; points: number; projected: number | null; winning: boolean; right?: boolean }) {
  return (
    <div className={`flex min-w-0 items-center gap-3 sm:gap-5 ${right ? "flex-row-reverse text-right" : ""}`}>
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-lg font-bold uppercase leading-tight sm:text-2xl">{name}</p>
        <p className="truncate text-xs text-slate-400">{owner}</p>
        {projected !== null && <p className="num mt-1 text-sm text-accent">Proj. {pts(projected)}</p>}
      </div>
      <span className={`num text-5xl font-extrabold leading-none sm:text-6xl ${winning ? "text-accent" : "text-white"}`}>{pts(points)}</span>
    </div>
  );
}

function TeamColumn({ title, score, clubs, projections }: { title: string; score: TeamRoundScore; clubs: Map<number, { shortName: string }>; projections: Map<number, PlayerProjection> }) {
  const starters = score.lines.filter((l) => l.slot === "STARTER");
  const bench = score.lines.filter((l) => l.slot === "BENCH");
  return (
    <div className="card">
      <div className="mb-3 flex items-baseline justify-between border-b border-white/10 pb-2">
        <h3 className="text-xl font-bold uppercase">{title}</h3>
        <span className="num text-3xl font-extrabold text-accent">{pts(score.points)}</span>
      </div>
      {!score.locked && <p className="mb-2 text-xs text-slate-400">Escalação provisória (a rodada ainda não travou).</p>}
      <ul className="space-y-0.5 text-sm">
        {starters.map((l) => (
          <li key={l.playerId}>
            <details className="group rounded-lg transition open:bg-white/[0.03]">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-white/[0.04]">
                <Pos position={l.position} />
                <span className="min-w-0 flex-1 truncate">
                  {l.name} <span className="text-slate-500">· {clubs.get(l.clubId)?.shortName}</span>
                </span>
                <PlayerStatus status={l.status} />
                {l.status !== "SCORED" && projections.has(l.playerId) && (
                  <span className="num text-xs text-accent" title="Projeção">p {pts(projections.get(l.playerId)!.points)}</span>
                )}
                <span className="num w-9 text-right text-base font-bold">{l.status === "SCORED" ? pts(l.points) : "–"}</span>
                <span className="text-slate-500 transition group-open:rotate-90" aria-hidden>
                  ›
                </span>
              </summary>
              {l.breakdown.length > 0 && (
                <ul className="mx-1.5 mb-2 ml-14 space-y-0.5 border-l border-white/10 pl-3 text-xs text-slate-300">
                  {l.breakdown.map((b, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span>{b.label}</span>
                      <Delta points={b.points} />
                    </li>
                  ))}
                  {!l.final && <li className="text-amber-300">parcial — confirmado no fechamento da rodada</li>}
                </ul>
              )}
            </details>
          </li>
        ))}
      </ul>
      {score.manager && (
        <details className="group mt-2 rounded-lg border-t border-white/10 pt-2 transition open:bg-white/[0.03]">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm hover:bg-white/[0.04]">
            <span className="inline-block w-10 shrink-0 rounded-md bg-violet-400/15 px-1 py-0.5 text-center text-[10px] font-bold tracking-wider text-violet-300 ring-1 ring-violet-400/30">TEC</span>
            <span className="min-w-0 flex-1 truncate">
              <Link href={`managers/${score.manager.coachId}`} className="hover:text-accent hover:underline">{score.manager.name}</Link> <span className="text-slate-500">· {clubs.get(score.manager.clubId)?.shortName}</span>
            </span>
            <span className="num w-9 text-right text-base font-bold">{score.manager.status === "SCORED" ? pts(score.manager.points) : "–"}</span>
            <span className="text-slate-500 transition group-open:rotate-90" aria-hidden>
              ›
            </span>
          </summary>
          {score.manager.breakdown.length > 0 && (
            <ul className="mx-1.5 mb-2 ml-14 space-y-0.5 border-l border-white/10 pl-3 text-xs text-slate-300">
              {score.manager.breakdown.map((b, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>{b.label}</span>
                  <Delta points={b.points} />
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
      <p className="label mt-4">Banco (não pontua)</p>
      <ul className="space-y-0.5 text-xs text-slate-500">
        {bench.map((l) => (
          <li key={l.playerId} className="flex justify-between px-1.5">
            <span>{l.name}</span>
            <span className="num">{l.status === "SCORED" ? pts(l.points) : "–"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
