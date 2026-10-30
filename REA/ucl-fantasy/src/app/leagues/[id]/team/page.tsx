import Link from "next/link";
import { game } from "@config/game";
import { setFormationAction, setManagerAction } from "@/app/actions";
import { byeRounds } from "@/domain/bye";
import { injuryLabel, injuryStatus } from "@/domain/injuries";
import { FORMATIONS, formationSlots, POSITIONS, requiredStarters } from "@/domain/roster";
import { subOrDefault } from "@/domain/subpositions";
import { teamOf } from "@/server/leagues";
import { projectRound } from "@/server/projections";
import { teamRoundScore } from "@/server/teamScore";
import { coachesByIds } from "@/server/manager";
import { PlayerAvatar } from "@/web/PlayerAvatar";
import { TeamBoard, type BoardPlayer } from "@/web/TeamBoard";
import { matchesByRound, roundsState, rosterView } from "@/web/queries";
import { requireMember } from "@/web/session";
import { Badge, Empty, Flash, formatDate, POSITION_LABEL, pts, Rating, type SearchParams } from "@/web/ui";

export default async function TeamPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { league, user, db } = await requireMember(Number(id));
  const team = await teamOf(db, league.id, user.id);
  if (!team) return <Empty>Você não tem time nesta liga.</Empty>;
  const roster = await rosterView(db, team.id);
  if (roster.length === 0) {
    return (
      <Empty>
        Seu elenco será montado no{" "}
        <Link href={`/leagues/${league.id}/draft`} className="font-semibold text-accent">
          draft
        </Link>
        .
      </Empty>
    );
  }
  const [{ current, locked }, byRound] = await Promise.all([roundsState(db, new Date()), matchesByRound(db)]);
  const lastRound = game.season.playoffs[game.season.playoffs.length - 1]!.toRound;
  const slots = formationSlots(team.formation);
  const [score, projections] = current
    ? await Promise.all([teamRoundScore(db, team.id, current.order), projectRound(db, current.order)])
    : [null, new Map()];
  const [manager] = team.managerId ? await coachesByIds(db, [team.managerId]) : [];
  const lineByPlayer = new Map(score?.lines.map((l) => [l.playerId, l]) ?? []);
  const projectedStarters =
    Math.round(roster.filter((p) => p.slot === "STARTER").reduce((s, p) => s + (projections.get(p.playerId)?.points ?? 0), 0) * 10) / 10;
  const missing = POSITIONS.flatMap((p) => {
    const gap = slots[p] - requiredStarters(roster, p, team.formation);
    return gap > 0 ? [`${gap} ${POSITION_LABEL[p]}`] : [];
  });

  const board: BoardPlayer[] = roster.map((p) => {
    const line = lineByPlayer.get(p.playerId);
    const byes = byeRounds(p.clubId, byRound, p.eliminated, current?.order ?? 1, lastRound);
    return {
      playerId: p.playerId,
      name: p.name,
      position: p.position,
      subPosition: subOrDefault(p.position, p.subPosition),
      club: p.club,
      photoUrl: p.photoUrl,
      slot: p.slot,
      points: line?.status === "SCORED" ? line.points : null,
      status: line && line.status !== "SCORED" ? line.status : null,
      projected: projections.get(p.playerId)?.points ?? 0,
      avg: p.games ? Math.round((p.total / p.games) * 10) / 10 : 0,
      games: p.games,
      injury: injuryLabel(p),
      injuryDoubt: injuryStatus(p) === "DOUBTFUL",
      injuryNote: p.injurySource === "AUTO" ? `Marcado automaticamente: ${p.injuryNote ?? "leitura das súmulas"}` : null,
      bye: byes.length ? byes.map((r) => `R${r}`).join(", ") : null,
      warning: p.eliminated !== null ? "Clube eliminado — troque no mercado" : !p.active ? "Fora da lista UEFA — troque no mercado" : null,
      href: `/leagues/${league.id}/players/${p.playerId}`,
    };
  });

  return (
    <div className="space-y-4">
      <Flash sp={sp} />
      <div className="card relative flex flex-wrap items-center justify-between gap-4 overflow-hidden">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-linear-to-l from-brand-500/15 to-transparent" />
        <div>
          <p className="eyebrow">{current?.name}</p>
          <h2 className="text-3xl font-extrabold uppercase">{team.name}</h2>
          <p className="mt-1 text-sm text-slate-400">
            {locked ? "🔒 Escalação travada até o fechamento da rodada" : `Trava em ${formatDate(current?.firstKickoff)}`}
            {" · "}Elenco {roster.length}/{game.roster.size}
          </p>
        </div>
        <div className="relative text-right">
          <p className="label">Pontos na rodada</p>
          <p className="num text-5xl font-extrabold leading-none text-accent">{pts(score?.points ?? 0)}</p>
          <p className="mt-1 text-xs text-slate-400">
            Projeção dos titulares: <b className="num text-base text-slate-200">{pts(projectedStarters)}</b>
          </p>
          {score?.awaitingData && (
            <div className="mt-1">
              <Badge tone="amber">Aguardando dados oficiais</Badge>
            </div>
          )}
        </div>
      </div>

      {missing.length > 0 && (
        <div className="rounded-xl bg-amber-400/10 px-4 py-3 text-sm text-amber-200 ring-1 ring-amber-400/25">
          <p>Faltam {missing.join(", ")} para completar a formação: você joga com menos de 11 (ou contrate no Mercado).</p>
          <p className="mt-1 text-xs text-amber-200/80">
            Contrate no{" "}
            <Link href={`/leagues/${league.id}/market`} className="font-semibold underline">
              Mercado
            </Link>
            .
          </p>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <form action={setFormationAction} className="card flex flex-wrap items-center gap-2 p-3 sm:p-3">
          <input type="hidden" name="leagueId" value={league.id} />
          <span className="label mb-0 mr-1">Formação</span>
          <div className="flex flex-wrap gap-1.5">
            {FORMATIONS.map((f) => (
              <label key={f} className="cursor-pointer">
                <input type="radio" name="formation" value={f} defaultChecked={f === team.formation} className="peer sr-only" disabled={locked} />
                <span className="num block rounded-lg px-2.5 py-1 text-sm font-bold ring-1 ring-white/15 transition peer-checked:bg-accent peer-checked:text-night-950 peer-checked:ring-accent hover:ring-white/40">
                  {f}
                </span>
              </label>
            ))}
          </div>
          <button className="btn-ghost ml-auto px-3 py-1 text-xs" disabled={locked}>
            Aplicar
          </button>
        </form>

        <div className="card flex items-center gap-3 p-3 sm:p-3">
          {manager ? (
            <>
              <PlayerAvatar name={manager.name} photoUrl={manager.photoUrl} position="GK" className="size-11 text-sm" />
              <div className="min-w-0 flex-1">
                <p className="label mb-0">Técnico</p>
                <Link href={`/leagues/${league.id}/managers/${manager.id}`} className="block truncate font-semibold hover:text-accent hover:underline">
                  {manager.name}
                </Link>
                <p className="text-xs text-slate-400">
                  {score?.manager?.status === "SCORED" ? (
                    <>
                      Rodada: <Rating points={score.manager.points} className="ml-1 !min-w-0 !text-xs" />
                    </>
                  ) : score?.manager?.status === "NO_MATCH" ? (
                    "Sem jogo na rodada"
                  ) : (
                    "Pontua quando o jogo termina"
                  )}
                </p>
              </div>
              <form action={setManagerAction}>
                <input type="hidden" name="leagueId" value={league.id} />
                <input type="hidden" name="returnTo" value={`/leagues/${league.id}/team`} />
                <button className="btn-ghost px-2 py-1 text-xs" disabled={locked}>
                  Dispensar
                </button>
              </form>
            </>
          ) : (
            <p className="text-sm text-slate-400">
              Sem técnico.{" "}
              <Link href={`/leagues/${league.id}/market?view=coaches`} className="font-semibold text-accent underline">
                Contrate um no Mercado
              </Link>{" "}
              (pontua pelo desempenho do time dele).
            </p>
          )}
        </div>
      </div>

      <TeamBoard leagueId={league.id} players={board} locked={locked} />
    </div>
  );
}
