import { Logo } from "./ui";

/** Moldura das telas de entrar/cadastrar. */
export function AuthCard({ title, subtitle, children, footer }: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-sm py-6 sm:py-12">
      <div className="mb-6 text-center">
        <Logo className="mx-auto size-12" />
        <h1 className="mt-3 text-3xl font-extrabold uppercase">{title}</h1>
        <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
      </div>
      {children}
      <p className="mt-4 text-center text-sm text-slate-400">{footer}</p>
    </div>
  );
}
