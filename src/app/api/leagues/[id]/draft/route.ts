import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { game } from "@config/game";
import { getDb, type Db } from "@/db/client";
import { clubs, draftPicks, leagueMembers, leagues, players } from "@/db/schema";
import { snakeOrder } from "@/domain/draft";
import { POSITIONS, positionMax } from "@/domain/roster";
import { subOrDefault, type SubPosition } from "@/domain/subpositions";
import type { Position } from "@/domain/types";
import { GameError } from "@/server/errors";
import { advanceDraft, makePick, teamOf } from "@/server/leagues";
import { leagueTeams, rosterView, searchPlayers } from "@/web/queries";
import { currentUser } from "@/web/session";

export const dynamic = "force-dynamic";

export interface DraftState {
  status: "SETUP" | "DRAFTING" | "ACTIVE" | "COMPLETE";
  serverNow: string;
  deadline: string | null;
  currentPick: number | null;
  totalPicks: number;
  onClockTeamId: number | null;
  myTeamId: number | null;
  teams: Array<{ id: number; name: string; owner: string }>;
  order: number[];
  picks: Array<{ overall: number; round: number; teamId: number; name: string; position: Position; club: string; auto: boolean }>;
  myRoster: Array<{ position: Position; subPosition: SubPosition; clubId: number }>;
  available: Array<{ playerId: number; name: string; position: Position; subPosition: SubPosition; photoUrl: string | null; club: string; clubId: number; total: number; avg: number }>;
  clubCap: number;
  quotas: Record<Position, number>;
}

async function authorize(params: Promise<{ id: string }>) {
  const user = await currentUser();
  if (!user) return null;
  const leagueId = Number((await params).id);
  const db = await getDb();
  const [member] = await db
    .select()
    .from(leagueMembers)
    .where(and(eq(leagueMembers.leagueId, leagueId), eq(leagueMembers.userId, user.id)));
  return member ? { user, leagueId, db } : null;
}

async function draftState(db: Db, leagueId: number, userId: number, url: URL): Promise<DraftState> {
  const [league] = await db.select().from(leagues).where(eq(leagues.id, leagueId));
  const teams = await leagueTeams(db, leagueId);
  const order = league!.draftOrder ?? [];
  const picks = await db
    .select({
      overall: draftPicks.overall,
      round: draftPicks.round,
      teamId: draftPicks.teamId,
      name: players.name,
      position: players.position,
      club: clubs.shortName,
      auto: draftPicks.auto,
    })
    .from(draftPicks)
    .innerJoin(players, eq(players.id, draftPicks.playerId))
    .innerJoin(clubs, eq(clubs.id, players.clubId))
    .where(eq(draftPicks.leagueId, leagueId))
    .orderBy(asc(draftPicks.overall));
  const myTeam = await teamOf(db, leagueId, userId);
  const position = url.searchParams.get("position") as Position | null;
  const available = await searchPlayers(db, {
    leagueId,
    onlyFree: true,
    position: position && ["GK", "DEF", "MID", "FWD"].includes(position) ? position : undefined,
    q: url.searchParams.get("q") || undefined,
    limit: 60,
  });
  const snake = snakeOrder(order);
  return {
    status: league!.status,
    serverNow: new Date().toISOString(),
    deadline: league!.draftPickDeadline?.toISOString() ?? null,
    currentPick: league!.draftCurrentPick,
    totalPicks: order.length * game.roster.size,
    onClockTeamId: league!.draftCurrentPick !== null ? (snake[league!.draftCurrentPick] ?? null) : null,
    myTeamId: myTeam?.id ?? null,
    teams: teams.map((t) => ({ id: t.id, name: t.name, owner: t.owner })),
    order,
    picks,
    myRoster: myTeam ? (await rosterView(db, myTeam.id)).map((p) => ({ position: p.position, subPosition: subOrDefault(p.position, p.subPosition), clubId: p.clubId })) : [],
    available: available
      .filter((p) => p.eliminated === null)
      .map((p) => ({ playerId: p.playerId, name: p.name, position: p.position, subPosition: subOrDefault(p.position, p.subPosition), photoUrl: p.photoUrl, club: p.club, clubId: p.clubId, total: p.total, avg: p.avg })),
    clubCap: game.roster.clubCap(league!.startRound),
    quotas: Object.fromEntries(POSITIONS.map((p) => [p, positionMax(p)])) as Record<Position, number>,
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(params);
  if (!auth) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  await advanceDraft(auth.db, auth.leagueId, new Date());
  return NextResponse.json(await draftState(auth.db, auth.leagueId, auth.user.id, request.nextUrl));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(params);
  if (!auth) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { playerId?: unknown };
  try {
    await makePick(auth.db, auth.leagueId, auth.user.id, Number(body.playerId), new Date());
  } catch (error) {
    if (error instanceof GameError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
  return NextResponse.json(await draftState(auth.db, auth.leagueId, auth.user.id, request.nextUrl));
}
