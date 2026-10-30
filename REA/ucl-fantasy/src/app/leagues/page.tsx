import Link from "next/link";
import { game } from "@config/game";
import { createLeagueAction, joinLeagueAction } from "../actions";
import { getDb } from "@/db/client";
import { myLeagues } from "@/web/queries";
import { requireUser } from "@/web/session";
import { Badge, Empty, Flash, type SearchParams } from "@/web/ui";

const STATUS = { SETUP: "Aguardando draft", DRAFTING: "Draft ao vivo", ACTIVE: "Em andamento", COMPLETE: "Encerrada" } as const;
const TONE = { SETUP: "slate", DRAFTING: "amber", ACTIVE: "green", COMPLETE: "blue" } as const;

export default async function LeaguesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const user = await requireUser();
  const leagues = await myLeagues(await getDb(), user.id);
  return (
    <div className="space-y-8">
      <Flash sp={sp} />
      <section>
        <p className="eyebrow">Olá, {user.name.split(" ")[0]}</p>
        <h1 className="mb-4 text-4xl font-extrabold uppercase">Minhas ligas</h1>
        {leagues.length === 0 ? (
          <Empty>Você ainda não está em nenhuma liga. Crie uma ou entre com um código de convite.</Empty>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {leagues.map((l) => (
              <li key={l.id}>
                <Link href={`/leagues/${l.id}`} className="card card-link group block overflow-hidden">
                  <div className="flex items-start justify-between gap-2">
                    <span className="grid size-11 place-items-center rounded-xl bg-linear-to-br from-brand-500 to-violet-600 font-display text-xl font-bold shadow-lg shadow-brand-500/30">
                      {l.name.slice(0, 1).toUpperCase()}
                    </span>
                    <Badge tone={TONE[l.status]}>
                      {l.status === "DRAFTING" && <span className="size-1.5 animate-pulse rounded-full bg-amber-300" />}
                      {STATUS[l.status]}
                    </Badge>
                  </div>
                  <p className="mt-3 font-display text-2xl font-bold uppercase leading-tight">{l.name}</p>
                  <p className="text-sm text-slate-400">{l.teamName}</p>
                  <p className="mt-3 text-xs font-semibold text-accent opacity-0 transition group-hover:opacity-100">Abrir liga →</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <form action={createLeagueAction} className="card space-y-3">
          <div>
            <p className="eyebrow">Novo</p>
            <h2 className="text-2xl font-bold uppercase">Criar liga</h2>
            <p className="text-sm text-slate-400">Você vira o comissário e convida os amigos com um código.</p>
          </div>
          <div>
            <label className="label" htmlFor="name">Nome da liga</label>
            <input className="input" id="name" name="name" required />
          </div>
          <div>
            <label className="label" htmlFor="teamName">Nome do seu time</label>
            <input className="input" id="teamName" name="teamName" required />
          </div>
          <div>
            <label className="label" htmlFor="maxTeams">Participantes</label>
            <select className="input" id="maxTeams" name="maxTeams" defaultValue="8">
              {Array.from({ length: game.league.maxTeams - game.league.minTeams + 1 }, (_, i) => game.league.minTeams + i).map((n) => (
                <option key={n} value={n}>
                  {n} times
                </option>
              ))}
            </select>
          </div>
          <button className="btn w-full py-2.5">Criar e virar comissário</button>
        </form>

        <form action={joinLeagueAction} className="card space-y-3">
          <div>
            <p className="eyebrow">Convite</p>
            <h2 className="text-2xl font-bold uppercase">Entrar em uma liga</h2>
            <p className="text-sm text-slate-400">Peça o código de 6 letras ao comissário.</p>
          </div>
          <div>
            <label className="label" htmlFor="code">Código de convite</label>
            <input
              className="input text-center font-mono text-lg uppercase tracking-[0.4em]"
              id="code"
              name="code"
              required
              maxLength={6}
              placeholder="ABC123"
            />
          </div>
          <div>
            <label className="label" htmlFor="teamName2">Nome do seu time</label>
            <input className="input" id="teamName2" name="teamName" required />
          </div>
          <button className="btn-accent w-full py-2.5">Entrar</button>
        </form>
      </div>
    </div>
  );
}
