import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { leagueMembers, leagues } from "@/db/schema";
import { userForSession } from "@/server/auth";

export const SESSION_COOKIE = "ucl_session";

export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return userForSession(await getDb(), token);
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** Usuário logado + liga em que ele é membro (404 lógico → volta para a lista). */
export async function requireMember(leagueId: number) {
  const user = await requireUser();
  const db = await getDb();
  const [row] = await db
    .select({ league: leagues, role: leagueMembers.role })
    .from(leagueMembers)
    .innerJoin(leagues, eq(leagues.id, leagueMembers.leagueId))
    .where(and(eq(leagueMembers.leagueId, leagueId), eq(leagueMembers.userId, user.id)));
  if (!row) redirect("/leagues");
  return { user, league: row.league, isCommissioner: row.league.commissionerId === user.id, db };
}
