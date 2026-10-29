import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { logoutAction } from "./actions";
import { currentUser } from "@/web/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "UCL Fantasy",
  description: "Fantasy head-to-head da Champions League com estatísticas reais.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#070b24" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh">
        <header className="bg-brand-950 text-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
            <Link href={user ? "/leagues" : "/"} className="flex items-center gap-2 text-lg font-bold">
              <span className="text-accent">★</span> UCL Fantasy
            </Link>
            {user && (
              <form action={logoutAction} className="flex items-center gap-3 text-sm">
                <span className="hidden text-slate-300 sm:inline">{user.name}</span>
                <button className="rounded-md px-2 py-1 text-slate-300 hover:bg-white/10 hover:text-white">Sair</button>
              </form>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-5">{children}</main>
      </body>
    </html>
  );
}
