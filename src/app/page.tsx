import Link from "next/link";
import { redirect } from "next/navigation";
import { ScoringRules } from "@/web/ScoringRules";
import { currentUser } from "@/web/session";

const FEATURES = [
  { icon: "⏱", title: "Draft snake ao vivo", text: "60 segundos por escolha, com auto-pick se o tempo acabar. Cada jogador tem um dono só." },
  { icon: "⚔", title: "Head-to-head", text: "Toda rodada da Champions vira um confronto contra outro time da sua liga." },
  { icon: "📊", title: "Pontuação por scouts", text: "Regras do Cartola FC aplicadas à Champions: finalizações, desarmes, defesas, SG e mais, com os dados oficiais." },
];

export default async function Home() {
  if (await currentUser()) redirect("/leagues");
  return (
    <div className="space-y-14 py-4 sm:py-10">
      <section className="relative mx-auto max-w-3xl text-center">
        <p className="eyebrow">Champions League · Fantasy head-to-head</p>
        <h1 className="mt-3 text-5xl font-extrabold uppercase leading-[0.95] sm:text-7xl">
          Monte seu elenco.
          <br />
          <span className="bg-linear-to-r from-brand-300 via-white to-accent bg-clip-text text-transparent">Vença a noite.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-slate-300">
          Ligas privadas entre amigos, draft ao vivo e confrontos a cada rodada da Champions, com pontuação baseada
          nas estatísticas oficiais de cada partida.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/register" className="btn-accent px-6 py-3 text-base">
            Criar conta grátis
          </Link>
          <Link href="/login" className="btn-ghost px-6 py-3 text-base">
            Entrar
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="card">
            <span className="grid size-10 place-items-center rounded-xl bg-linear-to-br from-brand-500/30 to-accent/20 text-lg ring-1 ring-white/10">
              {f.icon}
            </span>
            <h2 className="mt-3 text-xl font-bold uppercase">{f.title}</h2>
            <p className="mt-1 text-sm text-slate-400">{f.text}</p>
          </div>
        ))}
      </section>

      <section>
        <div className="mb-4 text-center">
          <p className="eyebrow">Regras</p>
          <h2 className="text-3xl font-extrabold uppercase">Como cada jogador pontua</h2>
        </div>
        <ScoringRules />
      </section>
    </div>
  );
}
