import { managerScoring, scoring, type Every, type Position } from "@config/scoring";
import { POSITION_LABEL, signedPts } from "./ui";

/** Quadro de regras montado a partir de config/scoring.ts — nunca fica desatualizado. */

interface Rule {
  /** Sigla do scout no Cartola; ausente = scout extra deste jogo. */
  code?: string;
  label: string;
  value: string;
  tone: "plus" | "minus";
  who?: string;
}

const each = (n: number) => `${signedPts(n)} cada`;
const every = (rule: Every, noun: string) => (rule.per === 1 ? each(rule.points) : `${signedPts(rule.points)} a cada ${rule.per} ${noun}`);
const only = (positions: readonly Position[]) => positions.map((p) => POSITION_LABEL[p]).join(", ");
const tone = (n: number): Rule["tone"] => (n >= 0 ? "plus" : "minus");
const goalValue = () => {
  const values = new Set(Object.values(scoring.goal));
  return values.size === 1
    ? each(scoring.goal.FWD)
    : (Object.entries(scoring.goal) as Array<[Position, number]>).map(([p, v]) => `${POSITION_LABEL[p]} ${signedPts(v)}`).join(" · ");
};
const cleanSheetPositions = (Object.keys(scoring.cleanSheet.points) as Position[]).filter((p) => scoring.cleanSheet.points[p] > 0);
const sameCleanSheet = new Set(cleanSheetPositions.map((p) => scoring.cleanSheet.points[p])).size === 1;
const { appearance } = scoring;

const GROUPS: Array<{ title: string; rules: Rule[] }> = [
  {
    title: "Ataque",
    rules: [
      { code: "G", label: "Gol", value: goalValue(), tone: "plus" },
      { code: "A", label: "Assistência", value: each(scoring.assist), tone: "plus" },
      { code: "FT", label: "Finalização na trave", value: each(scoring.shotWoodwork), tone: "plus", who: "quando a fonte de dados informa" },
      { code: "FD", label: "Finalização defendida", value: each(scoring.shotSaved), tone: "plus", who: "chute no gol que não entrou" },
      { code: "FF", label: "Finalização para fora", value: each(scoring.shotOffTarget), tone: "plus", who: "inclui chutes bloqueados" },
      { code: "FS", label: "Falta sofrida", value: each(scoring.foulSuffered), tone: "plus" },
      { code: "PS", label: "Pênalti sofrido", value: each(scoring.penaltyWon), tone: "plus" },
      { code: "PP", label: "Pênalti perdido", value: each(scoring.penaltyMissed), tone: "minus" },
      { code: "I", label: "Impedimento", value: each(scoring.offside), tone: "minus" },
      {
        code: "PI",
        label: "Passe incompleto",
        value: every(scoring.passesMissed, "passes"),
        tone: tone(scoring.passesMissed.points),
        who: `${only(scoring.passesMissed.positions)} (goleiro não perde)`,
      },
    ],
  },
  {
    title: "Defesa",
    rules: [
      { code: "DS", label: "Desarme", value: each(scoring.tackle), tone: "plus" },
      {
        code: "SG",
        label: "Jogo sem sofrer gol",
        value: sameCleanSheet
          ? `${signedPts(scoring.cleanSheet.points[cleanSheetPositions[0] ?? "GK"])}`
          : cleanSheetPositions.map((p) => `${POSITION_LABEL[p]} ${signedPts(scoring.cleanSheet.points[p])}`).join(" · "),
        tone: "plus",
        who: `${only(cleanSheetPositions)} com ${scoring.cleanSheet.minMinutes}'+ em campo`,
      },
      { code: "DE", label: "Defesa", value: every(scoring.saves, "defesas"), tone: "plus", who: only(scoring.saves.positions) },
      { code: "DP", label: "Defesa de pênalti", value: each(scoring.penaltySaved), tone: "plus", who: "GOL" },
      { code: "GS", label: "Gol sofrido", value: every(scoring.goalsConceded, "gols"), tone: "minus", who: only(scoring.goalsConceded.positions) },
    ],
  },
  {
    title: "Punições",
    rules: [
      { code: "FC", label: "Falta cometida", value: every(scoring.foulsCommitted, "faltas"), tone: "minus" },
      { code: "PC", label: "Pênalti cometido", value: each(scoring.penaltyConceded), tone: "minus" },
      { code: "CA", label: "Cartão amarelo", value: each(scoring.yellowCard), tone: "minus" },
      { code: "CV", label: "Cartão vermelho", value: each(scoring.redCard), tone: "minus" },
      { code: "GC", label: "Gol contra", value: each(scoring.ownGoal), tone: "minus" },
    ],
  },
  {
    title: "Extras deste jogo",
    rules: [
      { label: "Passes certos", value: every(scoring.passesCompleted, "passes"), tone: tone(scoring.passesCompleted.points) },
      { label: "Drible certo", value: each(scoring.dribble), tone: "plus" },
      { label: "Bola recuperada", value: each(scoring.ballRecovered), tone: "plus", who: "inclui interceptações" },
      ...(appearance.partial || appearance.full
        ? [
            {
              label: "Tempo em campo",
              value: `${signedPts(appearance.partial)} até ${appearance.fullMinutes - 1}' · ${signedPts(appearance.full)} com ${appearance.fullMinutes}'+`,
              tone: "plus" as const,
            },
          ]
        : []),
    ],
  },
];

export function ScoringRules() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">
        Baseado na pontuação do <b className="text-slate-200">Cartola FC</b>. As siglas são as mesmas do Cartola; o grupo
        “Extras” traz scouts que o Cartola não pontua.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {GROUPS.map((g) => (
          <section key={g.title} className="card">
            <h3 className="mb-2 text-base font-bold uppercase tracking-wider text-slate-300">{g.title}</h3>
            <ul className="divide-y divide-white/5 text-sm">
              {g.rules.map((r) => (
                <li key={r.label} className="flex items-center justify-between gap-3 py-2">
                  <span className="flex items-center gap-2.5">
                    <span className="num grid h-6 w-8 shrink-0 place-items-center rounded-md bg-white/5 text-xs font-bold text-slate-300 ring-1 ring-white/10">
                      {r.code ?? "+"}
                    </span>
                    <span>
                      {r.label}
                      {r.who && <span className="block text-xs text-slate-500">{r.who}</span>}
                    </span>
                  </span>
                  <span
                    className={`num shrink-0 rounded-lg px-2 py-0.5 text-right text-sm font-semibold ${r.tone === "plus" ? "bg-emerald-400/10 text-emerald-300" : "bg-red-400/10 text-red-300"}`}
                  >
                    {r.value}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <section className="card">
          <h3 className="mb-2 text-base font-bold uppercase tracking-wider text-slate-300">Técnico</h3>
          <p className="mb-2 text-xs text-slate-400">
            Cada time pode contratar 1 técnico real. Ele pontua pelo desempenho do clube dele na rodada: média dos pontos dos jogadores que atuaram
            (mínimo {managerScoring.minMinutes} min) mais o bônus de resultado.
          </p>
          <ul className="divide-y divide-white/5 text-sm">
            {[
              { label: "Vitória", n: managerScoring.win },
              { label: "Empate", n: managerScoring.draw },
              { label: "Derrota", n: managerScoring.loss },
              { label: "Jogo sem sofrer gol", n: managerScoring.cleanSheet },
            ].map((r) => (
              <li key={r.label} className="flex items-center justify-between gap-3 py-2">
                <span>{r.label}</span>
                <span className={`num rounded-lg px-2 py-0.5 text-sm font-semibold ${r.n >= 0 ? "bg-emerald-400/10 text-emerald-300" : "bg-red-400/10 text-red-300"}`}>{signedPts(r.n)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
