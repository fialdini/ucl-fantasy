import { game } from "@config/game";
import { leagueStandings } from "@/server/season";
import { leagueTeams } from "@/web/queries";
import { requireMember } from "@/web/session";

export default async function StandingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { league, user, db } = await requireMember(Number(id));
  const [rows, teams] = await Promise.all([leagueStandings(db, league.id), leagueTeams(db, league.id)]);
  const team = (id: number) => teams.find((t) => t.id === id);
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th className="w-8">#</th>
            <th>Time</th>
            <th className="text-center">V</th>
            <th className="text-center">E</th>
            <th className="text-center">D</th>
            <th className="text-right">Pró</th>
            <th className="hidden text-right sm:table-cell">Contra</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const t = team(r.teamId);
            return (
              <tr key={r.teamId} className={t?.userId === user.id ? "bg-brand-700/5" : ""}>
                <td className={i < game.season.playoffTeams ? "font-bold text-emerald-700" : "text-slate-500"}>{i + 1}</td>
                <td>
                  <span className="font-medium">{t?.name}</span>
                  <span className="block text-xs text-slate-500">{t?.owner}</span>
                </td>
                <td className="text-center tabular-nums">{r.wins}</td>
                <td className="text-center tabular-nums">{r.ties}</td>
                <td className="text-center tabular-nums">{r.losses}</td>
                <td className="text-right tabular-nums">{r.pointsFor}</td>
                <td className="hidden text-right tabular-nums sm:table-cell">{r.pointsAgainst}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-slate-500">
        Top {game.season.playoffTeams} (em verde) vão aos playoffs. Ordem de waiver: inversa a esta tabela.
      </p>
    </div>
  );
}
