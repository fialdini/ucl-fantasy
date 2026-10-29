import Link from "next/link";
import { game } from "@config/game";
import { createLeagueAction, joinLeagueAction } from "../actions";
import { getDb } from "@/db/client";
import { myLeagues } from "@/web/queries";
import { requireUser } from "@/web/session";
import { Badge, Flash, type SearchParams } from "@/web/ui";

const STATUS = { SETUP: "Aguardando draft", DRAFTING: "Draft ao vivo", ACTIVE: "Em andamento", COMPLETE: "Encerrada" } as const;

export default async function LeaguesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const user = await requireUser();
  const leagues = await myLeagues(await getDb(), user.id);
  return (
    <div className="space-y-5">
      <Flash sp={sp} />
      <section>
        <h1 className="mb-3 text-2xl font-bold">Minhas ligas</h1>
        {leagues.length === 0 ? (
          <p className="card text-sm text-slate-600">Você ainda não está em nenhuma liga. Crie uma ou entre com um código.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {leagues.map((l) => (
              <li key={l.id}>
                <Link href={`/leagues/${l.id}`} className="card block hover:ring-brand-500">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{l.name}</span>
                    <Badge tone={l.status === "DRAFTING" ? "amber" : l.status === "ACTIVE" ? "green" : "slate"}>
                      {STATUS[l.status]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{l.teamName}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <form action={createLeagueAction} className="card space-y-3">
          <h2 className="font-semibold">Criar liga</h2>
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
          <button className="btn w-full">Criar e virar comissário</button>
        </form>

        <form action={joinLeagueAction} className="card space-y-3">
          <h2 className="font-semibold">Entrar em uma liga</h2>
          <div>
            <label className="label" htmlFor="code">Código de convite</label>
            <input className="input uppercase" id="code" name="code" required maxLength={6} />
          </div>
          <div>
            <label className="label" htmlFor="teamName2">Nome do seu time</label>
            <input className="input" id="teamName2" name="teamName" required />
          </div>
          <button className="btn w-full">Entrar</button>
        </form>
      </div>
    </div>
  );
}
