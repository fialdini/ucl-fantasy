import { Fragment } from "react";
import { game } from "@config/game";
import { leagueStandings } from "@/server/season";
import { leagueTeams } from "@/web/queries";
import { requireMember } from "@/web/session";
import { pts, signedPts } from "@/web/ui";

export default async function StandingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { league, user, db } = await requireMember(Number(id));
  const [rows, teams] = await Promise.all([leagueStandings(db, league.id), leagueTeams(db, league.id)]);
  const team = (id: number) => teams.find((t) => t.id === id);
  const medal = ["bg-gold text-night-950", "bg-slate-300 text-night-950", "bg-amber-700 text-white"];
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th className="w-10">#</th>
            <th>Time</th>
            <th className="text-center">V</th>
            <th className="text-center">E</th>
            <th className="text-center">D</th>
            <th className="text-right">Pró</th>
            <th className="hidden text-right sm:table-cell">Contra</th>
            <th className="hidden text-right sm:table-cell">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const t = team(r.teamId);
            const mine = t?.userId === user.id;
            const diff = Math.round((r.pointsFor - r.pointsAgainst) * 100) / 100;
            return (
              <Fragment key={r.teamId}>
                {i === game.season.playoffTeams && (
                  <tr aria-hidden>
                    <td colSpan={8} className="border-b-0 p-0">
                      <div className="flex items-center gap-2 py-1 text-[10px] font-bold uppercase tracking-widest text-accent/80">
                        <span className="h-px flex-1 bg-accent/40" /> linha dos playoffs <span className="h-px flex-1 bg-accent/40" />
                      </div>
                    </td>
                  </tr>
                )}
                <tr className={mine ? "bg-accent/[0.06]" : ""}>
                  <td>
                    <span
                      className={`num grid size-7 place-items-center rounded-lg text-sm font-bold ${
                        medal[i] ?? (i < game.season.playoffTeams ? "bg-accent/15 text-accent" : "bg-white/5 text-slate-400")
                      }`}
                    >
                      {i + 1}
                    </span>
                  </td>
                  <td>
                    <span className="font-semibold">
                      {t?.name}
                      {mine && <span className="ml-2 text-xs font-bold text-accent">VOCÊ</span>}
                    </span>
                    <span className="block text-xs text-slate-400">{t?.owner}</span>
                  </td>
                  <td className="num text-center text-base font-semibold text-emerald-300">{r.wins}</td>
                  <td className="num text-center text-base text-slate-300">{r.ties}</td>
                  <td className="num text-center text-base text-red-300">{r.losses}</td>
                  <td className="num text-right text-base font-bold">{pts(r.pointsFor)}</td>
                  <td className="num hidden text-right text-base text-slate-400 sm:table-cell">{pts(r.pointsAgainst)}</td>
                  <td className={`num hidden text-right text-base sm:table-cell ${diff > 0 ? "text-emerald-300" : diff < 0 ? "text-red-300" : "text-slate-400"}`}>
                    {signedPts(diff)}
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-slate-400">
        Top {game.season.playoffTeams} vão aos playoffs. Ordem de waiver: inversa a esta tabela.
      </p>
    </div>
  );
}
