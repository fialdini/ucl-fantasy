import { requireMember } from "@/web/session";
import { DraftRoom } from "./DraftRoom";

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { league } = await requireMember(Number(id));
  return <DraftRoom leagueId={league.id} />;
}
