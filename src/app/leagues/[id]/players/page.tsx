import { POSITIONS } from "@/domain/roster";
import type { Position } from "@/domain/types";
import { allClubs, searchPlayers } from "@/web/queries";
import { requireMember } from "@/web/session";
import { param, Pos, POSITION_LABEL, type SearchParams } from "@/web/ui";

export default async function PlayersPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { league, db } = await requireMember(Number(id));
  const position = (POSITIONS as readonly string[]).includes(param(sp, "position") ?? "") ? (param(sp, "position") as Position) : undefined;
  const clubId = Number(param(sp, "club")) || undefined;
  const sort = param(sp, "sort") === "avg" ? "avg" : "total";
  const q = param(sp, "q") || undefined;
  const onlyFree = param(sp, "free") === "1";
  const [clubs, rows] = await Promise.all([
    allClubs(db),
    searchPlayers(db, { leagueId: league.id, position, clubId, sort, q, onlyFree, limit: 150 }),
  ]);

  return (
    <div className="space-y-4">
      <form className="card grid grid-cols-2 gap-2 sm:grid-cols-6">
        <select name="position" defaultValue={position ?? ""} className="input">
          <option value="">Posição</option>
          {POSITIONS.map((p) => (
            <option key={p} value={p}>
              {POSITION_LABEL[p]}
            </option>
          ))}
        </select>
        <select name="club" defaultValue={clubId ?? ""} className="input">
          <option value="">Clube</option>
          {clubs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="sort" defaultValue={sort} className="input">
          <option value="total">Pontos totais</option>
          <option value="avg">Média por jogo</option>
        </select>
        <input name="q" defaultValue={q} placeholder="Nome" className="input" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="free" value="1" defaultChecked={onlyFree} className="size-4" /> Só livres
        </label>
        <button className="btn">Filtrar</button>
      </form>

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Jogador</th>
              <th className="hidden sm:table-cell">Clube</th>
              <th className="text-right">Total</th>
              <th className="text-right">Média</th>
              <th className="hidden text-right sm:table-cell">Jogos</th>
              <th>Dono</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.playerId}>
                <td>
                  <div className="flex items-center gap-2">
                    <Pos position={p.position} />
                    <span className="font-medium">{p.name}</span>
                  </div>
                  <span className="text-xs text-slate-500 sm:hidden">{p.club}</span>
                  {p.eliminated !== null && <span className="block text-xs text-red-700">clube eliminado</span>}
                </td>
                <td className="hidden sm:table-cell">{p.club}</td>
                <td className="text-right font-semibold tabular-nums">{p.total}</td>
                <td className="text-right tabular-nums">{p.avg.toFixed(1)}</td>
                <td className="hidden text-right tabular-nums sm:table-cell">{p.games}</td>
                <td className="text-xs">{p.ownerTeam ?? <span className="text-emerald-700">livre</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
