import Link from "next/link";
import { requireMember } from "@/web/session";

export default async function LeagueLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { league, isCommissioner } = await requireMember(Number(id));
  const base = `/leagues/${league.id}`;
  const tabs = [
    { href: base, label: "Liga" },
    ...(league.status === "DRAFTING" || league.status === "SETUP" ? [{ href: `${base}/draft`, label: "Draft" }] : []),
    { href: `${base}/team`, label: "Meu time" },
    { href: `${base}/matchup`, label: "Confronto" },
    { href: `${base}/standings`, label: "Classificação" },
    { href: `${base}/market`, label: "Mercado" },
    { href: `${base}/players`, label: "Jogadores" },
    ...(isCommissioner ? [{ href: `${base}/admin`, label: "Comissário" }] : []),
  ];
  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-bold">{league.name}</h1>
        <nav className="-mx-4 mt-2 overflow-x-auto px-4">
          <ul className="flex gap-1 whitespace-nowrap text-sm">
            {tabs.map((t) => (
              <li key={t.href}>
                <Link href={t.href} className="block rounded-lg px-3 py-1.5 font-medium text-slate-600 hover:bg-white hover:text-brand-700">
                  {t.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      {children}
    </div>
  );
}
