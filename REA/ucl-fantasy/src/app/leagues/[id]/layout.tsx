import { teamOf } from "@/server/leagues";
import { leagueOpenTrades, pendingTradesFor } from "@/server/trades";
import { requireMember } from "@/web/session";
import { LeagueTabs } from "@/web/LeagueTabs";
import { Badge } from "@/web/ui";

const STATUS = { SETUP: "Aguardando draft", DRAFTING: "Draft ao vivo", ACTIVE: "Em andamento", COMPLETE: "Encerrada" } as const;
const TONE = { SETUP: "slate", DRAFTING: "amber", ACTIVE: "green", COMPLETE: "blue" } as const;

export default async function LeagueLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { league, isCommissioner, user, db } = await requireMember(Number(id));
  const team = league.status === "ACTIVE" ? await teamOf(db, league.id, user.id) : null;
  const pendingTrades = team ? (await pendingTradesFor(db, league.id, team.id)).length : 0;
  const toReview = isCommissioner ? (await leagueOpenTrades(db, league.id)).filter((t) => t.status === "REVIEW").length : 0;
  const base = `/leagues/${league.id}`;
  const tabs = [
    { href: base, label: "Liga" },
    ...(league.status === "DRAFTING" || league.status === "SETUP" ? [{ href: `${base}/draft`, label: "Draft" }] : []),
    { href: `${base}/team`, label: "Meu time" },
    { href: `${base}/matchup`, label: "Confronto" },
    { href: `${base}/standings`, label: "Classificação" },
    { href: `${base}/market`, label: "Mercado" },
    { href: `${base}/trades`, label: "Trocas", badge: pendingTrades },
    { href: `${base}/rules`, label: "Pontuação" },
    ...(isCommissioner ? [{ href: `${base}/admin`, label: "Comissário", badge: toReview }] : []),
  ];
  return (
    <div>
      <div className="mb-6 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Liga privada</p>
            <h1 className="text-4xl font-extrabold uppercase leading-none">{league.name}</h1>
          </div>
          <Badge tone={TONE[league.status]}>{STATUS[league.status]}</Badge>
        </div>
        <LeagueTabs base={base} tabs={tabs} />
      </div>
      {children}
    </div>
  );
}
