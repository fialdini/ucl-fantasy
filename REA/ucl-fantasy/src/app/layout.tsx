import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Inter } from "next/font/google";
import Link from "next/link";
import { logoutAction } from "./actions";
import { currentUser } from "@/web/session";
import { Logo } from "@/web/ui";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-display-face",
  display: "swap",
});

export const metadata: Metadata = {
  title: "UCL Fantasy",
  description: "Fantasy head-to-head da Champions League com estatísticas reais.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#040716" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="pt-BR" className={`${inter.variable} ${display.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-night-950/70 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
            <Link href={user ? "/leagues" : "/"} className="group flex items-center gap-2.5">
              <Logo className="size-8 transition group-hover:rotate-12" />
              <span className="font-display text-xl font-bold uppercase tracking-wide">
                UCL <span className="text-accent">Fantasy</span>
              </span>
            </Link>
            {user && (
              <form action={logoutAction} className="flex items-center gap-3 text-sm">
                <Link href="/leagues" className="hidden rounded-lg px-2 py-1 text-slate-300 hover:text-white sm:inline">
                  Minhas ligas
                </Link>
                <span className="flex items-center gap-2">
                  <span className="grid size-8 place-items-center rounded-full bg-linear-to-br from-brand-500 to-accent text-xs font-bold text-night-950">
                    {user.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="hidden text-slate-300 md:inline">{user.name}</span>
                </span>
                <button className="rounded-lg px-2 py-1 text-slate-400 transition hover:bg-white/10 hover:text-white">Sair</button>
              </form>
            )}
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
        <footer className="border-t border-white/[0.06] py-5 text-center text-xs text-slate-500">
          UCL Fantasy · pontuação calculada com as estatísticas oficiais de cada partida
        </footer>
      </body>
    </html>
  );
}
