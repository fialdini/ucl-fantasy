import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { game } from "@config/game";
import { createDb } from "@/db/client";
import { rounds } from "@/db/schema";
import { currentRound } from "@/domain/lock";
import { advanceSimulationClock, getProvider } from "@/providers";
import { runScheduledJobs } from "@/server/jobs";

const DAY = 86_400_000;

describe("relógio da simulação", () => {
  it("adiantar até o fim da rodada vigente faz a rodada ser jogada e fechada", async () => {
    const db = await createDb({ memory: true });
    const now = new Date();
    await runScheduledJobs({ db, provider: await getProvider(db), now });
    const current = currentRound(await db.select().from(rounds));
    expect(current?.order).toBe(2);

    // Mesma conta do botão "Simulação: jogar a próxima rodada".
    const closesAt = current!.lastKickoff!.getTime() + (game.sync.matchDurationMinutes + game.sync.closeDelayHours * 60 + 5) * 60_000;
    await advanceSimulationClock(db, Math.ceil((closesAt - now.getTime()) / DAY) * DAY);
    await runScheduledJobs({ db, provider: await getProvider(db), now }, { forceCalendar: true });

    const [round2] = await db.select().from(rounds).where(eq(rounds.order, 2));
    expect(round2?.closedAt).not.toBeNull();
    const [round3] = await db.select().from(rounds).where(eq(rounds.order, 3));
    expect(round3?.closedAt).toBeNull();
    expect(round3!.firstKickoff!.getTime()).toBeGreaterThan(now.getTime());
  });
});
