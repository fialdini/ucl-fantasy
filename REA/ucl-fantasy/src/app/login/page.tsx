import Link from "next/link";
import { loginAction } from "../actions";
import { AuthCard } from "@/web/AuthCard";
import { Flash, type SearchParams } from "@/web/ui";

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  return (
    <AuthCard
      title="Entrar"
      subtitle="Bem-vindo de volta. Sua liga está esperando."
      footer={
        <>
          Não tem conta? <Link href="/register" className="font-semibold text-accent hover:underline">Cadastre-se</Link>
        </>
      }
    >
      <Flash sp={sp} />
      <form action={loginAction} className="card space-y-4">
        <div>
          <label className="label" htmlFor="email">E-mail</label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Senha</label>
          <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <button className="btn w-full py-2.5">Entrar</button>
      </form>
    </AuthCard>
  );
}
