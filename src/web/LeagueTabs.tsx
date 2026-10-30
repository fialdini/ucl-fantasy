"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Abas da liga com a aba atual destacada. */
export function LeagueTabs({ base, tabs }: { base: string; tabs: Array<{ href: string; label: string; badge?: number }> }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === base ? pathname === base : pathname.startsWith(href));
  return (
    <nav className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]">
      <ul className="flex w-max gap-1 rounded-2xl bg-night-900/70 p-1 text-sm ring-1 ring-white/[0.07]">
        {tabs.map((t) => {
          const active = isActive(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`block whitespace-nowrap rounded-xl px-3.5 py-2 font-semibold transition ${
                  active
                    ? "bg-linear-to-r from-brand-500 to-violet-500 text-white shadow-md shadow-brand-500/30"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                {t.label}
                {t.badge ? (
                  <span className="ml-1.5 inline-grid min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-bold text-night-950">
                    {t.badge}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
