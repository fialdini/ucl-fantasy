import { commissionerTradeAction, simulateDraftAction, updateSettingsAction } from "@/app/actions";
import type { leagues } from "@/db/schema";
import { LEAGUE_LIMITS } from "@/server/leagues";
import type { leagueOpenTrades } from "@/server/trades";
import { SubmitButton } from "@/web/SubmitButton";
import { Badge, Empty, formatDate, Pos, SectionTitle } from "@/web/ui";

type League = typeof leagues.$inferSelect;
type OpenTrade = Awaited<ReturnType<typeof leagueOpenTrades>>[number];

const UNITS = [
  { value: 3600, label: "horas" },
  { value: 60, label: "minutos" },
  { value: 1, label: "segundos" },
] as const;

/** Maior unidade que representa o tempo sem fração (90 s → 90 segundos; 120 s → 2 minutos). */
function splitSeconds(seconds: number) {
  const unit = UNITS.find((u) => seconds % u.value === 0) ?? UNITS[2];
  return { amount: seconds / unit.value, unit: unit.value };
}

export function describeSeconds(seconds: number) {
  const { amount, unit } = splitSeconds(seconds);
  const label = UNITS.find((u) => u.value === unit)!.label;
  return `${amount} ${amount === 1 ? label.slice(0, -1) : label}`;
}

/** Simulação do draft: tudo no automático, 1 segundo por escolha. */
export function DraftSimulation({ league }: { league: League }) {
  if (league.status !== "SETUP" && league.status !== "DRAFTING") return null;
  return (
    <form action={simulateDraftAction} className="card flex flex-wrap items-center justify-between gap-3">
      <input type="hidden" name="leagueId" value={league.id} />
      <div>
        <h2 className="text-lg font-bold uppercase">Simular draft</h2>
        <p className="text-xs text-slate-400">
          {league.status === "SETUP" ? "Inicia o draft" : "Acelera o draft em andamento"} com 1 segundo por escolha: quem não
          escolher a tempo recebe o melhor jogador disponível (auto-pick). Abra a sala de draft para acompanhar. Depois, volte o
          tempo em “Configurações da liga”.
        </p>
      </div>
      <SubmitButton className="btn-accent" pendingText="Preparando…">
        Simular com 1 s por escolha
      </SubmitButton>
    </form>
  );
}

export function LeagueSettings({ league }: { league: League }) {
  const pick = splitSeconds(league.draftPickSeconds);
  const { draftPickSeconds: pickLimits, tradeReviewHours: reviewLimits } = LEAGUE_LIMITS;
  return (
    <form action={updateSettingsAction} className="card space-y-4">
      <input type="hidden" name="leagueId" value={league.id} />
      <SectionTitle>Configurações da liga</SectionTitle>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="label" htmlFor="pickValue">Tempo por escolha no draft</label>
          <div className="flex gap-2">
            <input
              className="input w-28"
              id="pickValue"
              name="pickValue"
              type="number"
              min={1}
              step="any"
              defaultValue={pick.amount}
              required
            />
            <select name="pickUnit" className="input w-auto" defaultValue={pick.unit} aria-label="Unidade">
              {UNITS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Atual: {describeSeconds(league.draftPickSeconds)}. De {pickLimits.min} segundos a {pickLimits.max / 3600} horas.
            {league.status === "DRAFTING" && " O draft está em andamento: o relógio da escolha atual recomeça com o novo tempo."}
          </p>
        </div>
        <div>
          <label className="label" htmlFor="tradeReviewHours">Revisão de trocas pelo comissário (horas)</label>
          <input
            className="input w-28"
            id="tradeReviewHours"
            name="tradeReviewHours"
            type="number"
            min={reviewLimits.min}
            max={reviewLimits.max}
            defaultValue={league.tradeReviewHours}
            required
          />
          <p className="mt-1 text-xs text-slate-400">
            Troca aceita fica em revisão por esse prazo: você pode vetar ou aprovar antes; depois é concluída sozinha. 0 = sem
            revisão (concluída na hora do aceite).
          </p>
        </div>
      </div>
      <SubmitButton className="btn" pendingText="Salvando…">
        Salvar configurações
      </SubmitButton>
    </form>
  );
}

export function TradeReview({ leagueId, trades, teamName }: { leagueId: number; trades: OpenTrade[]; teamName: (id: number) => string }) {
  const review = trades.filter((t) => t.status === "REVIEW");
  const pending = trades.filter((t) => t.status === "PENDING");
  return (
    <div className="card">
      <SectionTitle aside={review.length > 0 ? <Badge tone="amber">{review.length} aguardando você</Badge> : undefined}>
        Trocas: revisão e veto
      </SectionTitle>
      {trades.length === 0 ? (
        <Empty>Nenhuma troca em revisão ou proposta pendente.</Empty>
      ) : (
        <ul className="space-y-3">
          {[...review, ...pending].map((t) => (
            <li key={t.id} className={`rounded-xl p-3 ring-1 ${t.status === "REVIEW" ? "bg-amber-400/[0.05] ring-amber-400/30" : "bg-white/[0.02] ring-white/10"}`}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-semibold">
                  {teamName(t.proposerTeamId)} <span className="text-slate-500">⇄</span> {teamName(t.receiverTeamId)}
                </span>
                {t.status === "REVIEW" ? (
                  <Badge tone="amber">Em revisão · concluída em {formatDate(t.reviewEndsAt)}</Badge>
                ) : (
                  <Badge tone="blue">Proposta pendente</Badge>
                )}
              </div>
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                {[t.proposerTeamId, t.receiverTeamId].map((teamId) => (
                  <div key={teamId}>
                    <p className="label">{teamName(teamId)} envia</p>
                    <ul className="space-y-1">
                      {t.items
                        .filter((i) => i.fromTeamId === teamId)
                        .map((i) => (
                          <li key={i.playerId} className="flex items-center gap-2">
                            <Pos position={i.position} />
                            {i.name}
                          </li>
                        ))}
                    </ul>
                  </div>
                ))}
              </div>
              {t.message && <p className="mt-2 text-xs italic text-slate-400">“{t.message}”</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <form action={commissionerTradeAction} className="flex flex-wrap gap-2">
                  <input type="hidden" name="leagueId" value={leagueId} />
                  <input type="hidden" name="tradeId" value={t.id} />
                  <input type="hidden" name="decision" value="veto" />
                  <input name="reason" className="input w-56 py-1.5 text-xs" placeholder="Motivo do veto (opcional)" maxLength={200} />
                  <SubmitButton className="btn-ghost px-3 py-1.5 text-xs text-red-300 ring-red-400/40" pendingText="Vetando…">
                    Vetar
                  </SubmitButton>
                </form>
                {t.status === "REVIEW" && (
                  <form action={commissionerTradeAction}>
                    <input type="hidden" name="leagueId" value={leagueId} />
                    <input type="hidden" name="tradeId" value={t.id} />
                    <input type="hidden" name="decision" value="approve" />
                    <SubmitButton className="btn-accent px-3 py-1.5 text-xs" pendingText="Aprovando…">
                      Aprovar agora
                    </SubmitButton>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
