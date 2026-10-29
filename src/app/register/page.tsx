import Link from "next/link";
import { registerAction } from "../actions";
import { Flash, type SearchParams } from "@/web/ui";

export default async function RegisterPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-4 text-2xl font-bold">Criar conta</h1>
      <Flash sp={sp} />
      <form action={registerAction} className="card space-y-3">
        <div>
          <label className="label" htmlFor="name">Nome</label>
          <input className="input" id="name" name="name" autoComplete="name" required />
        </div>
        <div>
          <label className="label" htmlFor="email">E-mail</label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Senha (mín. 8)</label>
          <input className="input" id="password" name="password" type="password" minLength={8} autoComplete="new-password" required />
        </div>
        <button className="btn w-full">Criar conta</button>
      </form>
      <p className="mt-3 text-center text-sm text-slate-600">
        Já tem conta? <Link href="/login" className="font-semibold text-brand-700">Entrar</Link>
      </p>
    </div>
  );
}
