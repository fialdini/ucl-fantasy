import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import { playerMatchStats } from "@/db/schema";
import { getProvider } from "@/providers";
import { recalcPoints, runScheduledJobs } from "@/server/jobs";

describe("recalcular pontos", () => {
  it("relê as súmulas do provider, recupera scouts e pontos, e não muda o status final", async () => {
    const db = await createDb({ memory: true });
    const ctx = { db, provider: await getProvider(db), now: new Date() };
    await runScheduledJobs(ctx);
    const [before] = await db.select().from(playerMatchStats).where(eq(playerMatchStats.roundOrder, 1)).limit(1);
    expect(before).toBeDefined();
    const key = and(eq(playerMatchStats.playerId, before!.playerId), eq(playerMatchStats.matchId, before!.matchId));

    // Simula uma linha antiga: scout novo zerado e pontos da tabela anterior.
    await db.update(playerMatchStats).set({ foulsSuffered: 0, offsides: 0, points: 999 }).where(key);
    const r = await recalcPoints(ctx);
    expect(r.message).toMatch(/relidas do cache/);

    const [after] = await db.select().from(playerMatchStats).where(key);
    expect(after).toMatchObject({ foulsSuffered: before!.foulsSuffered, offsides: before!.offsides, points: before!.points, final: before!.final });
  });
});
