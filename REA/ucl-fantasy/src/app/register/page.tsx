import Link from "next/link";
import { registerAction } from "../actions";
import { AuthCard } from "@/web/AuthCard";
import { Flash, type SearchParams } from "@/web/ui";

export default async function RegisterPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  return (
    <AuthCard
      title="Criar conta"
      subtitle="Em um minuto você já está montando sua liga."
      footer={
        <>
          Já tem conta? <Link href="/login" className="font-semibold text-accent hover:underline">Entrar</Link>
        </>
      }
    >
      <Flash sp={sp} />
      <form action={registerAction} className="card space-y-4">
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
        <button className="btn w-full py-2.5">Criar conta</button>
      </form>
    </AuthCard>
  );
}
