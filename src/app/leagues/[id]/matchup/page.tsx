import Link from "next/link";
import { game } from "@config/game";
import { teamOf } from "@/server/leagues";
import { teamRoundScore, type TeamRoundScore } from "@/server/teamScore";
import { clubNames, leagueTeams, roundMatchups, roundsState } from "@/web/queries";
import { requireMember } from "@/web/session";
import { Badge, param, PlayerStatus, Pos, type SearchParams } from "@/web/ui";

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
  const selectedId = Number(param(sp, "m") ?? matchups.find((m) => m.homeTeamId === myTeam?.id || m.awayTeamId === myTeam?.id)?.id ?? matchups[0]?.id);
  const selected = matchups.find((m) => m.id === selectedId);
  const [home, away] = selected
    ? await Promise.all([teamRoundScore(db, selected.homeTeamId, roundOrder), teamRoundScore(db, selected.awayTeamId, roundOrder)])
    : [null, null];
  const rounds = all.filter((r) => r.order >= league.startRound && r.order <= game.season.playoffs[1].toRound);

  return (
    <div className="space-y-4">
      <nav className="-mx-4 overflow-x-auto px-4">
        <ul className="flex gap-1 whitespace-nowrap text-xs">
          {rounds.map((r) => (
            <li key={r.order}>
              <Link
                href={`?round=${r.order}`}
                className={`block rounded-full px-3 py-1 font-semibold ${r.order === roundOrder ? "bg-brand-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}
              >
                R{r.order}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <h2 className="font-semibold">{round?.name}</h2>

      {matchups.length === 0 ? (
        <p className="card text-sm text-slate-500">Nenhum confronto nesta rodada.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {matchups.map((m) => (
            <li key={m.id}>
              <Link
                href={`?round=${roundOrder}&m=${m.id}`}
                className={`card flex items-center justify-between gap-2 text-sm ${m.id === selectedId ? "ring-2 ring-brand-500" : ""}`}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{name(m.homeTeamId)}</span>
                <span className="font-mono font-bold tabular-nums">
                  {m.homePoints ?? 0} × {m.awayPoints ?? 0}
                </span>
                <span className="min-w-0 flex-1 truncate text-right font-medium">{name(m.awayTeamId)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {selected && home && away && (
        <div className="card">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-slate-500">{KIND[selected.kind]}</span>
            {selected.status === "FINAL" ? (
              <Badge tone="green">Final</Badge>
            ) : home.awaitingData || away.awaitingData ? (
              <Badge tone="amber">Parcial · aguardando dados oficiais</Badge>
            ) : (
              <Badge tone="blue">{selected.status === "PARTIAL" ? "Parcial" : "A jogar"}</Badge>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <TeamColumn title={name(selected.homeTeamId)} score={home} clubs={clubs} />
            <TeamColumn title={name(selected.awayTeamId)} score={away} clubs={clubs} />
          </div>
        </div>
      )}
    </div>
  );
}

function TeamColumn({ title, score, clubs }: { title: string; score: TeamRoundScore; clubs: Map<number, { shortName: string }> }) {
  const starters = score.lines.filter((l) => l.slot === "STARTER");
  const bench = score.lines.filter((l) => l.slot === "BENCH");
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between border-b border-slate-200 pb-1">
        <h3 className="font-bold">{title}</h3>
        <span className="text-2xl font-bold tabular-nums">{score.points}</span>
      </div>
      {!score.locked && <p className="mb-2 text-xs text-slate-500">Escalação provisória (a rodada ainda não travou).</p>}
      <ul className="space-y-1 text-sm">
        {starters.map((l) => (
          <li key={l.playerId}>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2">
                <Pos position={l.position} />
                <span className="min-w-0 flex-1 truncate">
                  {l.name} <span className="text-slate-400">· {clubs.get(l.clubId)?.shortName}</span>
                </span>
                <PlayerStatus status={l.status} />
                <span className="w-8 text-right font-semibold tabular-nums">{l.status === "SCORED" ? l.points : "–"}</span>
              </summary>
              {l.breakdown.length > 0 && (
                <ul className="mb-1 ml-12 mt-1 text-xs text-slate-600">
                  {l.breakdown.map((b, i) => (
                    <li key={i} className="flex justify-between">
                      <span>{b.label}</span>
                      <span className="tabular-nums">{b.points > 0 ? `+${b.points}` : b.points}</span>
                    </li>
                  ))}
                  {!l.final && <li className="text-amber-700">parcial — confirmado no fechamento da rodada</li>}
                </ul>
              )}
            </details>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs font-semibold uppercase text-slate-400">Banco (não pontua)</p>
      <ul className="text-xs text-slate-500">
        {bench.map((l) => (
          <li key={l.playerId} className="flex justify-between">
            <span>{l.name}</span>
            <span className="tabular-nums">{l.status === "SCORED" ? l.points : "–"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
