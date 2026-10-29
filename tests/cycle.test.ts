import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { leagues, matches, matchups, playerMatchStats, players, rosterSlots, rounds, users, waiverClaims, clubs } from "@/db/schema";
import { validateLineup } from "@/domain/roster";
import { mulberry32 } from "@/providers/mock/season";
import { MockProvider } from "@/providers/mock/provider";
import { runScheduledJobs, processWaivers, closeRound } from "@/server/jobs";
import { advanceDraft, createLeague, createWaiverClaim, joinLeague, rankedAvailable, setLineup, startDraft } from "@/server/leagues";
import { leagueStandings } from "@/server/season";
import { teamRoundScore } from "@/server/teamScore";

const DAY = 86_400_000;
const T0 = new Date("2026-09-20T12:00:00Z");
// Rodada 1: 15 e 16/09 (encerrada). Rodada 2: 22 e 23/09.
const anchor = new Date(T0.getTime() - 5 * DAY);

let db: Db;
let now = T0;
const provider = new MockProvider({ anchor, now: () => now });
const ctx = () => ({ db, provider, now });
let leagueId: number;
const userIds: number[] = [];

describe("ciclo completo com o provider mock", () => {
  beforeAll(async () => {
    db = await createDb({ memory: true });
  });

  it("sincroniza calendário, elencos e estatísticas e fecha a rodada 1", async () => {
    const results = await runScheduledJobs(ctx());
    expect(results.calendar?.ok).toBe(true);
    expect(results.squads?.ok).toBe(true);
    expect((await db.select().from(players)).length).toBe(900);
    const r1 = await db.select().from(matches).where(eq(matches.roundOrder, 1));
    expect(r1).toHaveLength(18);
    expect(r1.every((m) => m.statsStatus === "FINAL")).toBe(true);
    const [round1] = await db.select().from(rounds).where(eq(rounds.order, 1));
    expect(round1?.closedAt).not.toBeNull();
    const stats = await db.select().from(playerMatchStats).where(eq(playerMatchStats.roundOrder, 1));
    expect(stats.length).toBeGreaterThan(18 * 22);
    expect(stats.every((s) => s.final)).toBe(true);
  });

  it("cria a liga, recebe 6 times e faz o draft com auto-pick", async () => {
    for (let i = 0; i < 6; i++) {
      const [u] = await db.insert(users).values({ email: `u${i}@x.com`, name: `U${i}`, passwordHash: "x" }).returning();
      userIds.push(u!.id);
    }
    const league = await createLeague(db, { userId: userIds[0]!, name: "Liga Teste", teamName: "T0", maxTeams: 6 });
    leagueId = league.id;
    expect(league.startRound).toBe(2);
    for (let i = 1; i < 6; i++) await joinLeague(db, { userId: userIds[i]!, code: league.inviteCode, teamName: `T${i}` });

    await startDraft(db, leagueId, userIds[0]!, now, mulberry32(1));
    // Ninguém escolhe: 90 picks automáticos vencem em sequência.
    const made = await advanceDraft(db, leagueId, new Date(now.getTime() + 2 * 3_600_000));
    expect(made).toBe(90);
    const [l] = await db.select().from(leagues).where(eq(leagues.id, leagueId));
    expect(l?.status).toBe("ACTIVE");

    const slots = await db
      .select({ teamId: rosterSlots.teamId, playerId: rosterSlots.playerId, slot: rosterSlots.slot, position: players.position, clubId: players.clubId })
      .from(rosterSlots)
      .innerJoin(players, eq(players.id, rosterSlots.playerId))
      .where(eq(rosterSlots.leagueId, leagueId));
    expect(new Set(slots.map((s) => s.playerId)).size).toBe(90);
    for (const teamId of new Set(slots.map((s) => s.teamId))) {
      const roster = slots.filter((s) => s.teamId === teamId);
      expect(validateLineup(roster)).toBeNull();
      const perClub = new Map<number, number>();
      for (const s of roster) perClub.set(s.clubId, (perClub.get(s.clubId) ?? 0) + 1);
      expect(Math.max(...perClub.values())).toBeLessThanOrEqual(3);
    }
    // Rodadas 2..10 × 3 confrontos
    expect(await db.select().from(matchups).where(eq(matchups.leagueId, leagueId))).toHaveLength(27);
  });

  it("trava a escalação no início do primeiro jogo da rodada", async () => {
    const owner = userIds[0]!;
    const [teamRow] = await db.query.fantasyTeams.findMany({ where: (t, { eq: e, and: a }) => a(e(t.leagueId, leagueId), e(t.userId, owner)) });
    const starters = (await db.select().from(rosterSlots).where(eq(rosterSlots.teamId, teamRow!.id)))
      .filter((s) => s.slot === "STARTER")
      .map((s) => s.playerId);
    await expect(setLineup(db, leagueId, owner, starters, now)).resolves.toBeUndefined();
    const [round2] = await db.select().from(rounds).where(eq(rounds.order, 2));
    await expect(setLineup(db, leagueId, owner, starters, round2!.firstKickoff!)).rejects.toThrow(/travada/);
  });

  it("depois da rodada 2: pontua, fecha, define vencedores e abre waivers", async () => {
    // Último jogo da rodada 2 em T0+3d; fecha após 150 min + 24 h de prazo de correção.
    now = new Date(T0.getTime() + 5 * DAY);
    await runScheduledJobs(ctx());
    const [round2] = await db.select().from(rounds).where(eq(rounds.order, 2));
    expect(round2?.closedAt).not.toBeNull();

    const r2 = await db.select().from(matchups).where(and(eq(matchups.leagueId, leagueId), eq(matchups.fromRound, 2)));
    expect(r2).toHaveLength(3);
    for (const m of r2) {
      expect(m.status).toBe("FINAL");
      const home = await teamRoundScore(db, m.homeTeamId, 2);
      expect(home.locked).toBe(true);
      expect(home.points).toBe(m.homePoints);
      if (m.homePoints! > m.awayPoints!) expect(m.winnerTeamId).toBe(m.homeTeamId);
      if (m.homePoints === m.awayPoints) expect(m.winnerTeamId).toBeNull();
    }
    const standings = await leagueStandings(db, leagueId);
    expect(standings.every((r) => r.wins + r.ties + r.losses === 1)).toBe(true);

    const [l] = await db.select().from(leagues).where(eq(leagues.id, leagueId));
    expect(l?.waiverProcessAt).not.toBeNull();
    expect(l?.waiverMode).toBe("ROLLING");
  });

  it("processa o pedido de waiver na ordem inversa da classificação", async () => {
    const owner = userIds[0]!;
    const [teamRow] = await db.query.fantasyTeams.findMany({ where: (t, { eq: e, and: a }) => a(e(t.leagueId, leagueId), e(t.userId, owner)) });
    const roster = await db
      .select({ playerId: rosterSlots.playerId, position: players.position })
      .from(rosterSlots)
      .innerJoin(players, eq(players.id, rosterSlots.playerId))
      .where(eq(rosterSlots.teamId, teamRow!.id));
    const drop = roster.find((p) => p.position === "FWD")!;
    const clubsOnRoster = await db
      .select({ clubId: players.clubId })
      .from(rosterSlots)
      .innerJoin(players, eq(players.id, rosterSlots.playerId))
      .where(eq(rosterSlots.teamId, teamRow!.id));
    const counts = new Map<number, number>();
    for (const c of clubsOnRoster) counts.set(c.clubId, (counts.get(c.clubId) ?? 0) + 1);
    const add = (await rankedAvailable(db, leagueId)).find((p) => p.position === "FWD" && (counts.get(p.clubId) ?? 0) < 3)!;
    await createWaiverClaim(db, leagueId, owner, add.playerId, drop.playerId, now);

    // Antes do prazo nada acontece
    expect((await processWaivers(ctx())).message).toMatch(/0 liga/);
    now = new Date(now.getTime() + 25 * 3_600_000);
    await processWaivers(ctx());
    const [claim] = await db.select().from(waiverClaims).where(eq(waiverClaims.leagueId, leagueId));
    expect(claim?.status).toBe("SUCCEEDED");
    const [slot] = await db.select().from(rosterSlots).where(and(eq(rosterSlots.leagueId, leagueId), eq(rosterSlots.playerId, add.playerId)));
    expect(slot?.teamId).toBe(teamRow!.id);
  });
});

describe("dados oficiais atrasados", () => {
  it("não fecha a rodada e marca a partida como aguardando dados", async () => {
    const db2 = await createDb({ memory: true });
    let clock = T0;
    const base = new MockProvider({ anchor, now: () => clock });
    // Provider que "atrasa" uma partida: não devolve o detalhe dela.
    const delayed = Object.assign(Object.create(base), {
      getMatchDetails: async (ids: readonly number[]) => (await base.getMatchDetails(ids)).filter((d) => d.matchId !== 1001),
    }) as MockProvider;
    await runScheduledJobs({ db: db2, provider: delayed, now: clock });
    const [m] = await db2.select().from(matches).where(eq(matches.id, 1001));
    expect(m?.statsStatus).toBe("NONE");
    expect(m?.statsError).toMatch(/Aguardando dados oficiais/);
    const [round1] = await db2.select().from(rounds).where(eq(rounds.order, 1));
    expect(round1?.closedAt).toBeNull();
    const close = await closeRound({ db: db2, provider: delayed, now: clock }, 1);
    expect(close).toMatchObject({ closed: false });
    expect(close.message).toMatch(/Aguardando dados oficiais/);

    // Quando a fonte entrega, a rodada fecha.
    clock = new Date(clock.getTime() + 3_600_000);
    await runScheduledJobs({ db: db2, provider: base, now: clock });
    const [closed] = await db2.select().from(rounds).where(eq(rounds.order, 1));
    expect(closed?.closedAt).not.toBeNull();
    expect((await db2.select().from(clubs)).every((c) => c.eliminatedAfterRound === null)).toBe(true);
  });
});
