"use client";

import { useFormStatus } from "react-dom";

/** Botão de formulário que trava e avisa enquanto a ação do servidor roda (evita cliques repetidos). */
export function SubmitButton({ children, className = "btn", pendingText = "Processando…" }: {
  children: React.ReactNode;
  className?: string;
  pendingText?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  );
}
