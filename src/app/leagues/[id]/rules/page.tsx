import { ScoringRules } from "@/web/ScoringRules";

export default function RulesPage() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        A pontuação é parcial durante a rodada e confirmada no fechamento, com os dados oficiais.
      </p>
      <ScoringRules />
      <section className="card text-sm text-slate-300">
        <h3 className="mb-2 text-base font-bold uppercase tracking-wider text-slate-300">Elenco e escalação</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>19 jogadores: 11 titulares e 8 reservas. Sub-posições: goleiro, zagueiro, lateral, volante, meia, ponta e centroavante.</li>
          <li>Não há mínimo de jogadores por posição: o time pode jogar com menos de 11 (decisão do técnico — você).</li>
          <li>Titular e reserva só trocam de lugar com alguém da mesma sub-posição (lateral com lateral, zagueiro com zagueiro…). Dá para mandar um titular ao banco, ou levar um reserva para uma vaga livre da posição dele.</li>
          <li>
            Lesões são lidas automaticamente das súmulas da UEFA (dúvida quando o jogador sai cedo ou fica fora da relação do jogo). O comissário
            pode registrar lesões confirmadas, com previsão de retorno, e elas prevalecem.
          </li>
        </ul>
      </section>
    </div>
  );
}
