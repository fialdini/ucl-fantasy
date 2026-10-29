import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/web/session";

export default async function Home() {
  if (await currentUser()) redirect("/leagues");
  return (
    <div className="mx-auto max-w-xl py-10 text-center">
      <h1 className="text-3xl font-extrabold text-brand-950">Fantasy da Champions League</h1>
      <p className="mt-3 text-slate-600">
        Ligas privadas, draft snake ao vivo e confrontos head-to-head a cada rodada, com pontuação baseada nas
        estatísticas oficiais de cada partida.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/register" className="btn">
          Criar conta
        </Link>
        <Link href="/login" className="btn-ghost">
          Entrar
        </Link>
      </div>
    </div>
  );
}
