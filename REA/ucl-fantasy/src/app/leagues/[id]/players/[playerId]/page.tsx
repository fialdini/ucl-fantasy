import Link from "next/link";
import { SUB_LABEL, subOrDefault } from "@/domain/subpositions";
import { PlayerAvatar } from "@/web/PlayerAvatar";
import { notFound } from "next/navigation";
import { dropPlayerAction, setInjuryAction } from "@/app/actions";
import { injuryLabel, injuryStatus } from "@/domain/injuries";
import { lineupLockState } from "@/domain/lock";
import { teamOf } from "@/server/leagues";
import { projectRound } from "@/server/projections";
import { playerDetail } from "@/web/playerDetail";
import { requireMember } from "@/web/session";
import { SubmitButton } from "@/web/SubmitButton";
import { Badge, Delta, Empty, Flash, formatDate, SubPos, pts, SectionTitle, type SearchParams } from "@/web/ui";

const AVAILABILITY = { BYE: "Bye", ELIMINATED: "Eliminado", TBD: "A definir", PLAYS: "" } as const;

export default async function PlayerPage({ params, searchParams }: { params: Promise<{ id: string; playerId: string }>; searchParams: SearchParams }) {
  const [{ id, playerId }, sp] = await Promise.all([params, searchParams]);
  const { league, user, db, isCommissioner } = await requireMember(Number(id));
  const data = await playerDetail(db, league.id, Number(playerId));
  if (!data) notFound();
  const { player, club, owner, played, upcoming, byes, totals, previous, previousSeasonYear } = data;
  const myTeam = await teamOf(db, league.id, user.id);
  const projection = data.current ? (await projectRound(db, data.current.order)).get(player.id) ?? null : null;
  const opponent = projection?.opponentClubId ? data.season.find((s) => s.opponent?.id === projection.opponentClubId)?.opponent : null;
  const mine = owner !== null && owner.teamId === myTeam?.id;
  const locked = lineupLockState(data.season.map((s) => s.round), new Date()).locked;
  const injury = injuryLabel(player);
  const self = `/leagues/${league.id}/players/${player.id}`;

  return (
    <div className="space-y-4">
      <Flash sp={sp} />
      <div className="card relative overflow-hidden">
        <div className="pointer-events-none absolute -right-10 -top-10 size-48 rounded-full bg-brand-500/15 blur-3xl" />
        <div className="relative flex flex-wrap items-start gap-4">
          <PlayerAvatar name={player.name} photoUrl={player.photoUrl} position={player.position} className="size-20 text-2xl" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <SubPos position={player.position} sub={player.subPosition} />
              <span className="text-sm text-slate-400">{SUB_LABEL[subOrDefault(player.position, player.subPosition)]}</span>
              {injury && <Badge tone={injuryStatus(player) === "DOUBTFUL" ? "amber" : "red"}>✚ {injury}</Badge>}
              {injury && player.injurySource === "AUTO" && <span className="text-xs text-amber-300/80">automático: {player.injuryNote ?? "leitura das súmulas"}</span>}
              {byes.length > 0 && <Badge tone="blue">Bye: {byes.map((r) => `R${r}`).join(", ")}</Badge>}
              {club.eliminatedAfterRound !== null && <Badge tone="red">Clube eliminado</Badge>}
            </div>
            <h2 className="mt-1 text-3xl font-extrabold uppercase leading-none">{player.name}</h2>
            <p className="mt-1 flex items-center gap-2 text-sm text-slate-300">
              {club.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={club.logoUrl} alt="" className="size-5 object-contain" />
              )}
              {club.name}
              <span className="text-slate-500">·</span>
              {owner ? (
                <span className={mine ? "font-semibold text-accent" : ""}>{mine ? "Seu time" : owner.teamName}</span>
              ) : (
                <span className="text-emerald-300">Livre</span>
              )}
            </p>
          </div>
          <div className="flex gap-4 text-right">
            {[
              ["Pontos", pts(totals.points)],
              ["Média", pts(totals.avg)],
              ["Jogos", String(totals.games)],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="label">{label}</p>
                <p className="num text-3xl font-extrabold leading-none">{value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative mt-4 flex flex-wrap gap-2">
          {mine && league.status === "ACTIVE" && locked && <Badge tone="amber">🔒 Rodada travada: dispensas reabrem no fechamento</Badge>}
          {mine && league.status === "ACTIVE" && !locked && (
            <form action={dropPlayerAction}>
              <input type="hidden" name="leagueId" value={league.id} />
              <input type="hidden" name="playerId" value={player.id} />
              <input type="hidden" name="returnTo" value={self} />
              <SubmitButton className="btn-ghost text-red-300 ring-red-400/40" pendingText="Dispensando…">
                Dispensar jogador
              </SubmitButton>
            </form>
          )}
          {!owner && league.status === "ACTIVE" && (
            <Link href={`/leagues/${league.id}/market?q=${encodeURIComponent(player.name)}`} className="btn-accent">
              Contratar no Mercado
            </Link>
          )}
          {owner && !mine && league.status === "ACTIVE" && (
            <Link href={`/leagues/${league.id}/trades?with=${owner.teamId}`} className="btn">
              Propor troca a {owner.teamName}
            </Link>
          )}
        </div>
      </div>

      {isCommissioner && (
        <form action={setInjuryAction} className="card flex flex-wrap items-end gap-3">
          <input type="hidden" name="leagueId" value={league.id} />
          <input type="hidden" name="playerId" value={player.id} />
          <input type="hidden" name="returnTo" value={self} />
          <div>
            <label className="label" htmlFor="status">Situação física (comissário)</label>
            <select id="status" name="status" className="input w-auto" defaultValue={injuryStatus(player)}>
              <option value="FIT">Disponível</option>
              <option value="DOUBTFUL">Dúvida</option>
              <option value="INJURED">Lesionado</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="returnDate">Volta prevista</label>
            <input
              id="returnDate"
              name="returnDate"
              type="date"
              className="input w-auto"
              defaultValue={player.injuryReturn && player.injuryReturn !== "DOUBTFUL" ? player.injuryReturn : ""}
            />
          </div>
          <SubmitButton className="btn-ghost" pendingText="Salvando…">
            Salvar
          </SubmitButton>
          <p className="w-full text-xs text-slate-500">
            Registre lesões da vida real; aparecem para todos os times. Volta prevista é opcional.
            {player.injuryUpdatedAt && ` Última atualização: ${formatDate(player.injuryUpdatedAt)}.`}
          </p>
        </form>
      )}

      {data.current && (
        <section className="card">
          <SectionTitle aside={<span className="num text-3xl font-extrabold text-accent">{pts(projection?.points ?? 0)}</span>}>
            Projeção · {data.current.name}
          </SectionTitle>
          {!projection || projection.minutes === 0 ? (
            <p className="text-sm text-slate-400">
              {injuryStatus(player) === "INJURED" ? "Lesionado: projeção zero." : "Sem jogo nesta rodada (bye ou eliminado): projeção zero."}
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ["Adversário", `${projection.home ? "vs" : "@"} ${opponent?.name ?? "—"}`],
                  ["Minutos esperados", `${projection.minutes}'`],
                  ["Chance de SG", `${Math.round(projection.cleanSheet * 100)}%`],
                  ["Gols esperados contra", pts(Math.round(projection.goalsAgainst * 10) / 10)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
                    <dt className="label">{label}</dt>
                    <dd className="font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
              <ul className="space-y-1 text-sm">
                {[...projection.lines].sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).map((l) => (
                  <li key={l.label} className="flex justify-between gap-2">
                    <span className="text-slate-300">{l.label}</span>
                    <Delta points={l.points} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Estimativa: ritmo do jogador por 90 min (esta temporada + metade do peso da anterior, puxado para a média da posição
            com poucos jogos) × minutos recentes, ajustado pela defesa e ataque do adversário e pelo mando de campo.
          </p>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <SectionTitle>Pontos por rodada</SectionTitle>
          {played.length === 0 ? (
            <Empty>Ainda sem rodadas jogadas.</Empty>
          ) : (
            <ul className="divide-y divide-white/5 text-sm">
              {played.map((s) => (
                <li key={s.round.order}>
                  {s.match ? (
                    <details className="group">
                      <summary className="flex cursor-pointer list-none items-center gap-3 py-2">
                        <span className="num w-9 font-bold text-slate-400">R{s.round.order}</span>
                        <span className="min-w-0 flex-1 truncate">
                          {s.home ? "vs" : "@"} {s.opponent?.name}
                          <span className="ml-2 text-xs text-slate-500">
                            {s.match.homeGoals ?? "–"}×{s.match.awayGoals ?? "–"}
                          </span>
                        </span>
                        <span className="text-xs text-slate-500">{s.stat ? `${s.stat.minutes}'` : "não jogou"}</span>
                        <span className="num w-12 text-right text-base font-bold">{s.stat ? pts(s.stat.points) : "–"}</span>
                        <span className="text-slate-500 transition group-open:rotate-90" aria-hidden>
                          ›
                        </span>
                      </summary>
                      {s.stat && s.stat.breakdown.length > 0 && (
                        <ul className="mb-2 ml-12 space-y-0.5 border-l border-white/10 pl-3 text-xs text-slate-300">
                          {s.stat.breakdown.map((b, i) => (
                            <li key={i} className="flex justify-between gap-2">
                              <span>{b.label}</span>
                              <Delta points={b.points} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </details>
                  ) : (
                    <div className="flex items-center gap-3 py-2">
                      <span className="num w-9 font-bold text-slate-400">R{s.round.order}</span>
                      <Badge tone="blue">{AVAILABILITY[s.availability]}</Badge>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <SectionTitle>Próximos jogos</SectionTitle>
          {upcoming.length === 0 && byes.length === 0 ? (
            <Empty>Sem jogos marcados por enquanto.</Empty>
          ) : (
            <ul className="divide-y divide-white/5 text-sm">
              {data.season
                .filter((s) => upcoming.includes(s) || (s.availability !== "PLAYS" && !s.round.closedAt && s.round.order >= (data.current?.order ?? 1)))
                .map((s) => (
                  <li key={s.round.order} className="flex items-center gap-3 py-2">
                    <span className="num w-9 font-bold text-slate-400">R{s.round.order}</span>
                    {s.match ? (
                      <>
                        <span className="min-w-0 flex-1 truncate">
                          {s.home ? "vs" : "@"} {s.opponent?.name}
                          <span className="ml-2 text-xs text-slate-500">{s.home ? "casa" : "fora"}</span>
                        </span>
                        <span className="text-xs text-slate-400">{formatDate(s.match.kickoff)}</span>
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 text-slate-400">{s.round.name}</span>
                        <Badge tone={s.availability === "BYE" ? "blue" : s.availability === "ELIMINATED" ? "red" : "slate"}>
                          {AVAILABILITY[s.availability]}
                        </Badge>
                      </>
                    )}
                  </li>
                ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Bye = rodada sem jogo do clube (não pontua). Na Champions acontece no playoff, que os 8 primeiros da fase de liga
            pulam, e após a eliminação.
          </p>
        </section>
      </div>

      <section className="card">
        <SectionTitle>
          {previousSeasonYear ? `Temporada passada (${previousSeasonYear - 1}/${String(previousSeasonYear).slice(2)})` : "Temporada passada"}
        </SectionTitle>
        {previous.length === 0 ? (
          <Empty>Sem histórico na Champions da temporada passada.</Empty>
        ) : (
          <>
            <p className="mb-2 text-xs text-slate-400">
              {previous.length} jogos · {pts(Math.round(previous.reduce((s, p) => s + p.points, 0) * 100) / 100)} pontos com a
              tabela atual.
            </p>
            <ul className="grid gap-x-6 divide-y divide-white/5 text-sm md:grid-cols-2 md:divide-y-0">
              {previous.map((h) => (
                <li key={h.matchId} className="flex items-center gap-3 border-white/5 py-1.5 md:border-b">
                  <span className="num w-9 font-bold text-slate-400">R{h.roundOrder}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {h.home ? "vs" : "@"} {h.opponentName}
                    {h.clubName !== club.name && <span className="ml-1 text-xs text-slate-500">({h.clubName})</span>}
                  </span>
                  <span className="text-xs text-slate-500">{h.minutes}'</span>
                  <span className="num w-12 text-right font-bold">{pts(h.points)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
