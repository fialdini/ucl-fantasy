import Link from "next/link";
import { loginAction } from "../actions";
import { Flash, type SearchParams } from "@/web/ui";

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-4 text-2xl font-bold">Entrar</h1>
      <Flash sp={sp} />
      <form action={loginAction} className="card space-y-3">
        <div>
          <label className="label" htmlFor="email">E-mail</label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Senha</label>
          <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <button className="btn w-full">Entrar</button>
      </form>
      <p className="mt-3 text-center text-sm text-slate-600">
        Não tem conta? <Link href="/register" className="font-semibold text-brand-700">Cadastre-se</Link>
      </p>
    </div>
  );
}
