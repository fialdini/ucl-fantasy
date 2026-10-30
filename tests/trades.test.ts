import { eq } from "drizzle-orm";
import { game } from "@config/game";
import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { fantasyTeams, players, rosterSlots, trades, users } from "@/db/schema";
import { validateLineup } from "@/domain/roster";
import { MockProvider } from "@/providers/mock/provider";
import { mulberry32 } from "@/providers/mock/season";
import { GameError } from "@/server/errors";
import { runScheduledJobs } from "@/server/jobs";
import { leagues } from "@/db/schema";
import { addFreeAgent, advanceDraft, createLeague, dropPlayer, joinLeague, rankedAvailable, startDraft, updateLeagueSettings } from "@/server/leagues";
import { acceptTrade, approveTrade, cancelTrade, processTradeReviews, proposeTrade, rejectTrade, vetoTrade } from "@/server/trades";

const DAY = 86_400_000;
const T0 = new Date("2026-09-20T12:00:00Z");
// Rodada 2 começa em 22/09: antes disso a escalação está destravada.
const provider = new MockProvider({ anchor: new Date(T0.getTime() - 5 * DAY), now: () => T0 });
let db: Db;
let leagueId: number;
const userIds: number[] = [];
const teamIds: number[] = [];

const roster = (teamId: number) =>
  db
    .select({ playerId: rosterSlots.playerId, position: players.position, clubId: players.clubId, slot: rosterSlots.slot })
    .from(rosterSlots)
    .innerJoin(players, eq(players.id, rosterSlots.playerId))
    .where(eq(rosterSlots.teamId, teamId));
const ofPosition = async (teamId: number, position: string) =>
  (await roster(teamId)).filter((p) => p.position === position).map((p) => p.playerId);
const teamHas = async (teamId: number, playerId: number) => (await roster(teamId)).some((p) => p.playerId === playerId);
const status = async (tradeId: number) => (await db.select().from(trades).where(eq(trades.id, tradeId)))[0];

describe("trocas entre times", () => {
  beforeAll(async () => {
    db = await createDb({ memory: true });
    await runScheduledJobs({ db, provider, now: T0 });
    for (let i = 0; i < 6; i++) {
      const [u] = await db.insert(users).values({ email: `t${i}@x.com`, name: `U${i}`, passwordHash: "x" }).returning();
      userIds.push(u!.id);
    }
    const league = await createLeague(db, { userId: userIds[0]!, name: "Trocas", teamName: "T0", maxTeams: 6 });
    leagueId = league.id;
    // Estes testes cobrem a troca concluída no aceite; a revisão do comissário tem testes próprios abaixo.
    await updateLeagueSettings(db, leagueId, userIds[0]!, { tradeReviewHours: 0 }, T0);
    for (let i = 1; i < 6; i++) await joinLeague(db, { userId: userIds[i]!, code: league.inviteCode, teamName: `T${i}` });
    await startDraft(db, leagueId, userIds[0]!, T0, mulberry32(3));
    await advanceDraft(db, leagueId, new Date(T0.getTime() + 2 * 3_600_000));
    for (const uid of userIds.slice(0, 3)) {
      const [t] = await db.select().from(fantasyTeams).where(eq(fantasyTeams.userId, uid));
      teamIds.push(t!.id);
    }
  }, 120_000);

  it("com os dois elencos cheios, 2 por 1 é recusado; depois de uma dispensa, passa", async () => {
    const [a, b] = [teamIds[0]!, teamIds[1]!];
    const give = [(await ofPosition(a, "MID"))[0]!];
    const get = (await ofPosition(b, "MID")).slice(0, 2);
    const input = { leagueId, userId: userIds[0]!, receiverTeamId: b, givePlayerIds: give, getPlayerIds: get };
    await expect(proposeTrade(db, input, T0)).rejects.toThrow(new RegExp(`T0: o elenco ficaria com ${game.roster.size + 1}`));

    await dropPlayer(db, leagueId, userIds[0]!, (await ofPosition(a, "FWD"))[0]!, T0);
    const trade = await proposeTrade(db, input, T0);
    await acceptTrade(db, leagueId, userIds[1]!, trade.id, T0);

    const [ra, rb] = [await roster(a), await roster(b)];
    expect(ra).toHaveLength(game.roster.size);
    expect(rb).toHaveLength(game.roster.size - 1);
    expect(ra.map((p) => p.playerId)).toEqual(expect.arrayContaining(get));
    expect(rb.map((p) => p.playerId)).toContain(give[0]);
    // Titulares reorganizados: as duas escalações continuam válidas.
    expect(validateLineup(ra)).toBeNull();
    expect(validateLineup(rb)).toBeNull();
    expect((await status(trade.id))?.status).toBe("ACCEPTED");
  });

  it("o time que ficou com vaga contrata um livre sem dispensar ninguém", async () => {
    const b = teamIds[1]!;
    const owned = new Set((await db.select().from(rosterSlots).where(eq(rosterSlots.leagueId, leagueId))).map((r) => r.playerId));
    const counts = new Map<number, number>();
    for (const p of await roster(b)) counts.set(p.clubId, (counts.get(p.clubId) ?? 0) + 1);
    const free = (await rankedAvailable(db, leagueId)).find((p) => !owned.has(p.playerId) && p.position === "MID" && (counts.get(p.clubId) ?? 0) < 3)!;
    await addFreeAgent(db, leagueId, userIds[1]!, free.playerId, null, T0);
    expect(await roster(b)).toHaveLength(game.roster.size);
    const other = (await rankedAvailable(db, leagueId)).find((p) => !owned.has(p.playerId) && p.playerId !== free.playerId)!;
    await expect(addFreeAgent(db, leagueId, userIds[1]!, other.playerId, null, T0)).rejects.toThrow(/Elenco cheio/);
  });

  it("recusar, cancelar e proposta que ficou obsoleta", async () => {
    const [a, b, c] = teamIds as [number, number, number];
    const [fwdA, fwdB, fwdC] = [await ofPosition(a, "FWD"), await ofPosition(b, "FWD"), await ofPosition(c, "FWD")];
    const oneForOne = (receiverTeamId: number, getId: number) =>
      proposeTrade(db, { leagueId, userId: userIds[0]!, receiverTeamId, givePlayerIds: [fwdA[0]!], getPlayerIds: [getId] }, T0);

    const t1 = await oneForOne(b, fwdB[0]!);
    await expect(acceptTrade(db, leagueId, userIds[0]!, t1.id, T0)).rejects.toThrow(/Só o time que recebeu/);
    await rejectTrade(db, leagueId, userIds[1]!, t1.id, T0);
    await expect(rejectTrade(db, leagueId, userIds[1]!, t1.id, T0)).rejects.toThrow(/já foi respondida/);

    const t2 = await oneForOne(b, fwdB[0]!);
    await cancelTrade(db, leagueId, userIds[0]!, t2.id, T0);
    expect((await status(t2.id))?.status).toBe("CANCELLED");

    // Duas propostas com o mesmo atacante de A: aceitar uma derruba a outra.
    const t3 = await oneForOne(b, fwdB[0]!);
    const t4 = await oneForOne(c, fwdC[0]!);
    await acceptTrade(db, leagueId, userIds[1]!, t3.id, T0);
    expect(await status(t4.id)).toMatchObject({ status: "FAILED", failReason: "Um dos jogadores já mudou de time" });
    await expect(acceptTrade(db, leagueId, userIds[2]!, t4.id, T0)).rejects.toThrow(GameError);
  });

  it("não aceita com a rodada travada", async () => {
    const [a, b] = [teamIds[0]!, teamIds[1]!];
    const t = await proposeTrade(
      db,
      { leagueId, userId: userIds[0]!, receiverTeamId: b, givePlayerIds: [(await ofPosition(a, "DEF"))[0]!], getPlayerIds: [(await ofPosition(b, "DEF"))[0]!] },
      T0,
    );
    await expect(acceptTrade(db, leagueId, userIds[1]!, t.id, new Date("2026-09-22T21:00:00Z"))).rejects.toThrow(/travada/);
    expect((await status(t.id))?.status).toBe("PENDING");
  });
});

describe("revisão do comissário e configurações", () => {
  const HOUR = 3_600_000;
  // Sem mínimo por posição no draft, a posição pedida pode faltar num dos times: cai na primeira que os dois têm.
  const swap = async (from: number, to: number, position: string) => {
    for (const pos of [position, "DEF", "MID", "FWD", "GK"]) {
      const give = await ofPosition(from, pos);
      const get = await ofPosition(to, pos);
      if (give[0] && get[0]) return { give: [give[0]], get: [get[0]] };
    }
    throw new Error("sem posição em comum");
  };

  it("tempo de escolha do draft: validado e aplicado ao pick em andamento", async () => {
    await expect(updateLeagueSettings(db, leagueId, userIds[1]!, { draftPickSeconds: 30 }, T0)).rejects.toThrow(/Só o comissário/);
    await expect(updateLeagueSettings(db, leagueId, userIds[0]!, { draftPickSeconds: 0 }, T0)).rejects.toThrow(/fora do permitido/);
    await updateLeagueSettings(db, leagueId, userIds[0]!, { draftPickSeconds: 2 * 3600 }, T0);
    const [l] = await db.select().from(leagues).where(eq(leagues.id, leagueId));
    expect(l?.draftPickSeconds).toBe(7200);
  });

  it("com revisão, a troca aceita espera; o comissário veta ou aprova; vencido o prazo, é concluída", async () => {
    await updateLeagueSettings(db, leagueId, userIds[0]!, { tradeReviewHours: 24 }, T0);
    const [a, b] = [teamIds[0]!, teamIds[1]!];

    // 1) Aceita → em revisão; comissário veta → nada muda nos elencos.
    let s1 = await swap(a, b, "GK");
    const t1 = await proposeTrade(db, { leagueId, userId: userIds[0]!, receiverTeamId: b, givePlayerIds: s1.give, getPlayerIds: s1.get }, T0);
    const r1 = await acceptTrade(db, leagueId, userIds[1]!, t1.id, T0);
    expect(r1.status).toBe("REVIEW");
    expect(await teamHas(a, s1.give[0]!)).toBe(true);
    await expect(vetoTrade(db, leagueId, userIds[1]!, t1.id, "", T0)).rejects.toThrow(/Só o comissário/);
    await vetoTrade(db, leagueId, userIds[0]!, t1.id, "desequilibrada", T0);
    expect(await status(t1.id)).toMatchObject({ status: "VETOED", failReason: "Vetada pelo comissário: desequilibrada" });
    expect(await teamHas(a, s1.give[0]!)).toBe(true);

    // 2) Aceita → comissário aprova na hora → jogadores trocados.
    s1 = await swap(a, b, "GK");
    const t2 = await proposeTrade(db, { leagueId, userId: userIds[0]!, receiverTeamId: b, givePlayerIds: s1.give, getPlayerIds: s1.get }, T0);
    await acceptTrade(db, leagueId, userIds[1]!, t2.id, T0);
    await approveTrade(db, leagueId, userIds[0]!, t2.id, T0);
    expect((await status(t2.id))?.status).toBe("ACCEPTED");
    expect(await teamHas(a, s1.get[0]!)).toBe(true);

    // 3) Aceita → ninguém mexe → o job conclui depois do prazo (e não antes).
    const s3 = await swap(a, b, "MID");
    const t3 = await proposeTrade(db, { leagueId, userId: userIds[0]!, receiverTeamId: b, givePlayerIds: s3.give, getPlayerIds: s3.get }, T0);
    await acceptTrade(db, leagueId, userIds[1]!, t3.id, T0);
    expect(await processTradeReviews(db, new Date(T0.getTime() + 23 * HOUR))).toBeNull();
    expect((await status(t3.id))?.status).toBe("REVIEW");
    // Antes de travar a rodada 2 (22/09), o prazo de 24 h já venceu em 21/09 12:00.
    const r = await processTradeReviews(db, new Date(T0.getTime() + 25 * HOUR));
    expect(r?.message).toContain("1 troca(s) concluída(s)");
    expect(await teamHas(a, s3.get[0]!)).toBe(true);
  });

  it("comissário também pode vetar uma proposta ainda não aceita", async () => {
    const [a, c] = [teamIds[0]!, teamIds[2]!];
    const s = await swap(a, c, "DEF");
    const t = await proposeTrade(db, { leagueId, userId: userIds[0]!, receiverTeamId: c, givePlayerIds: s.give, getPlayerIds: s.get }, T0);
    await vetoTrade(db, leagueId, userIds[0]!, t.id, "", T0);
    expect(await status(t.id)).toMatchObject({ status: "VETOED", failReason: "Vetada pelo comissário" });
    await expect(acceptTrade(db, leagueId, userIds[2]!, t.id, T0)).rejects.toThrow(/já foi respondida/);
  });
});
