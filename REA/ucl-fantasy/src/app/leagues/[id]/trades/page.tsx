import Link from "next/link";
import { game } from "@config/game";
import { proposeTradeAction, respondTradeAction } from "@/app/actions";
import { POSITIONS } from "@/domain/roster";
import { teamOf } from "@/server/leagues";
import { teamTrades } from "@/server/trades";
import { leagueTeams, roundsState, rosterView } from "@/web/queries";
import { requireMember } from "@/web/session";
import { SubmitButton } from "@/web/SubmitButton";
import { Badge, Empty, Flash, formatDate, param, Pos, pts, SectionTitle, type SearchParams, type Tone } from "@/web/ui";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "Pendente", tone: "blue" },
  REVIEW: { label: "Em revisão do comissário", tone: "amber" },
  VETOED: { label: "Vetada", tone: "red" },
  ACCEPTED: { label: "Concluída", tone: "green" },
  REJECTED: { label: "Recusada", tone: "red" },
  CANCELLED: { label: "Cancelada", tone: "slate" },
  FAILED: { label: "Não concluída", tone: "amber" },
};

type Roster = Awaited<ReturnType<typeof rosterView>>;
const byPosition = (roster: Roster) =>
  [...roster].sort((a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position) || b.total - a.total);

export default async function TradesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { league, user, db } = await requireMember(Number(id));
  const team = await teamOf(db, league.id, user.id);
  if (!team || league.status !== "ACTIVE") return <Empty>As trocas abrem depois do draft.</Empty>;

  const [teams, { current, locked }, history, myRoster] = await Promise.all([
    leagueTeams(db, league.id),
    roundsState(db, new Date()),
    teamTrades(db, league.id, team.id),
    rosterView(db, team.id),
  ]);
  const others = teams.filter((t) => t.id !== team.id);
  const partnerId = Number(param(sp, "with")) || null;
  const partner = others.find((t) => t.id === partnerId) ?? null;
  const partnerRoster = partner ? await rosterView(db, partner.id) : [];
  const name = (teamId: number) => teams.find((t) => t.id === teamId)?.name ?? "—";
  const closed = (current?.order ?? 1) > game.trades.lastRound;
  const received = history.filter((t) => t.status === "PENDING" && t.receiverTeamId === team.id);
  const sent = history.filter((t) => t.status === "PENDING" && t.proposerTeamId === team.id);
  const inReview = history.filter((t) => t.status === "REVIEW");
  const past = history.filter((t) => t.status !== "PENDING" && t.status !== "REVIEW");
  const hidden = <input type="hidden" name="leagueId" value={league.id} />;

  return (
    <div className="space-y-5">
      <Flash sp={sp} />
      <div className="card flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-slate-300">
          Proponha trocas a qualquer time da liga. Vale troca desigual (ex.: 2 por 1): quem recebe menos fica com vaga e
          pode pegar alguém livre no <Link href={`/leagues/${league.id}/market`} className="font-semibold text-accent">Mercado</Link>.
        </p>
        {closed ? (
          <Badge tone="red">Prazo encerrado (rodada {game.trades.lastRound})</Badge>
        ) : locked ? (
          <Badge tone="amber">🔒 Rodada travada: aceite quando fechar</Badge>
        ) : (
          <Badge tone="green">Trocas abertas até a rodada {game.trades.lastRound}</Badge>
        )}
        {league.tradeReviewHours > 0 && (
          <p className="w-full text-xs text-slate-400">
            Trocas aceitas passam {league.tradeReviewHours} h em revisão do comissário, que pode vetar, antes de serem concluídas.
          </p>
        )}
      </div>

      {received.length > 0 && (
        <section>
          <SectionTitle>Propostas recebidas</SectionTitle>
          <ul className="grid gap-3 lg:grid-cols-2">
            {received.map((t) => (
              <li key={t.id} className="card ring-accent/40">
                <TradeSummary trade={t} myTeamId={team.id} name={name} />
                <div className="mt-3 flex gap-2">
                  <form action={respondTradeAction}>
                    {hidden}
                    <input type="hidden" name="tradeId" value={t.id} />
                    <input type="hidden" name="decision" value="accept" />
                    <SubmitButton className="btn-accent" pendingText="Concluindo…">
                      Aceitar troca
                    </SubmitButton>
                  </form>
                  <form action={respondTradeAction}>
                    {hidden}
                    <input type="hidden" name="tradeId" value={t.id} />
                    <input type="hidden" name="decision" value="reject" />
                    <SubmitButton className="btn-ghost" pendingText="Recusando…">
                      Recusar
                    </SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <SectionTitle>Nova proposta</SectionTitle>
        <p className="label">Trocar com</p>
        <div className="mb-4 flex flex-wrap gap-2">
          {others.map((t) => (
            <Link
              key={t.id}
              href={`?with=${t.id}`}
              className={`rounded-xl px-3 py-1.5 text-sm font-semibold ring-1 transition ${
                t.id === partner?.id ? "bg-accent text-night-950 ring-accent" : "text-slate-300 ring-white/15 hover:ring-white/40"
              }`}
            >
              {t.name}
            </Link>
          ))}
        </div>
        {!partner ? (
          <Empty>Escolha um time para ver o elenco dele e montar a proposta.</Empty>
        ) : (
          <form action={proposeTradeAction} className="space-y-4">
            {hidden}
            <input type="hidden" name="receiverTeamId" value={partner.id} />
            <div className="grid gap-4 md:grid-cols-2">
              <RosterPicker title="Você envia" subtitle={team.name} field="give" roster={byPosition(myRoster)} />
              <RosterPicker title="Você recebe" subtitle={partner.name} field="get" roster={byPosition(partnerRoster)} />
            </div>
            <div>
              <label className="label" htmlFor="message">Mensagem (opcional)</label>
              <input className="input" id="message" name="message" maxLength={200} placeholder="Ex.: preciso de um goleiro, topa?" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-400">
                Até {game.trades.maxPlayersPerSide} jogadores de cada lado, mas um lado pode ficar vazio: dá para dar (ou pedir) um jogador por nada, desde que haja vaga no elenco de quem recebe. Os dois elencos precisam continuar válidos: até{" "}
                {game.roster.size} jogadores, máximo por posição (
                {POSITIONS.map((p) => `${game.roster.maxPerPosition[p]} ${p}`).join(", ")}) e por clube.
              </p>
              <SubmitButton className="btn" pendingText="Enviando…">
                Enviar proposta
              </SubmitButton>
            </div>
          </form>
        )}
      </section>

      {inReview.length > 0 && (
        <section>
          <SectionTitle>Em revisão do comissário</SectionTitle>
          <ul className="grid gap-3 lg:grid-cols-2">
            {inReview.map((t) => (
              <li key={t.id} className="card ring-amber-400/30">
                <TradeSummary trade={t} myTeamId={team.id} name={name} />
                <p className="mt-2 text-xs text-amber-300">
                  Aceita. É concluída em {formatDate(t.reviewEndsAt)}, a menos que o comissário vete antes.
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sent.length > 0 && (
        <section>
          <SectionTitle>Propostas enviadas</SectionTitle>
          <ul className="grid gap-3 lg:grid-cols-2">
            {sent.map((t) => (
              <li key={t.id} className="card">
                <TradeSummary trade={t} myTeamId={team.id} name={name} />
                <form action={respondTradeAction} className="mt-3">
                  {hidden}
                  <input type="hidden" name="tradeId" value={t.id} />
                  <input type="hidden" name="decision" value="cancel" />
                  <SubmitButton className="btn-ghost px-3 py-1 text-xs" pendingText="Cancelando…">
                    Cancelar proposta
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <SectionTitle>Histórico</SectionTitle>
        {past.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhuma troca ainda.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {past.map((t) => (
              <li key={t.id} className="py-3">
                <TradeSummary trade={t} myTeamId={team.id} name={name} compact />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

type Trade = Awaited<ReturnType<typeof teamTrades>>[number];

function TradeSummary({ trade, myTeamId, name, compact = false }: { trade: Trade; myTeamId: number; name: (id: number) => string; compact?: boolean }) {
  const other = trade.proposerTeamId === myTeamId ? trade.receiverTeamId : trade.proposerTeamId;
  const outgoing = trade.items.filter((i) => i.fromTeamId === myTeamId);
  const incoming = trade.items.filter((i) => i.fromTeamId !== myTeamId);
  const status = STATUS[trade.status]!;
  return (
    <div className="text-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">
          {trade.proposerTeamId === myTeamId ? "Para" : "De"} <span className="text-accent">{name(other)}</span>
          <span className="ml-2 text-xs font-normal text-slate-500">{formatDate(trade.createdAt)}</span>
        </span>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <div className={`grid gap-3 ${compact ? "sm:grid-cols-2" : "grid-cols-2"}`}>
        <PlayerList title="Você recebe" players={incoming} tone="text-emerald-300" />
        <PlayerList title="Você envia" players={outgoing} tone="text-red-300" />
      </div>
      {trade.message && <p className="mt-2 rounded-lg bg-white/[0.03] px-3 py-2 text-xs italic text-slate-300">“{trade.message}”</p>}
      {trade.failReason && <p className="mt-2 text-xs text-amber-300">{trade.failReason}</p>}
    </div>
  );
}

function PlayerList({ title, players, tone }: { title: string; players: Trade["items"]; tone: string }) {
  return (
    <div>
      <p className={`label ${tone}`}>{title}</p>
      <ul className="space-y-1">
        {players.length === 0 && <li className="text-xs italic text-slate-500">nada</li>}
        {players.map((p) => (
          <li key={p.playerId} className="flex items-center gap-2">
            <Pos position={p.position} />
            <span className="truncate">{p.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RosterPicker({ title, subtitle, field, roster }: { title: string; subtitle: string; field: "give" | "get"; roster: Roster }) {
  return (
    <fieldset className="rounded-xl bg-night-950/50 p-3 ring-1 ring-white/[0.07]">
      <legend className="sr-only">{title}</legend>
      <p className={`label ${field === "give" ? "text-red-300" : "text-emerald-300"}`}>{title}</p>
      <p className="mb-2 text-xs text-slate-500">{subtitle}</p>
      <ul className="max-h-96 space-y-0.5 overflow-y-auto">
        {roster.map((p) => (
          <li key={p.playerId}>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-white/[0.04] has-[:checked]:bg-accent/10 has-[:checked]:ring-1 has-[:checked]:ring-accent/40">
              <input type="checkbox" name={field} value={p.playerId} className="size-4 accent-accent" />
              <Pos position={p.position} />
              <span className="min-w-0 flex-1 truncate">
                {p.name} <span className="text-slate-500">· {p.club}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
