import { redirect } from "next/navigation";

/** A lista de jogadores agora vive no Mercado (com filtros por situação e posição). */
export default async function PlayersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/leagues/${id}/market`);
}
