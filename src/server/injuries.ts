import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { leagues, players } from "@/db/schema";
import { injuryFromForm } from "@/domain/injuries";
import { GameError } from "./errors";

/**
 * Comissário registra a lesão do jogador na vida real (ou a retira). Vale para o jogador em todas as
 * ligas deste servidor. Uma fonte automática de lesões, quando houver, grava os mesmos campos.
 */
export async function setPlayerInjury(db: Db, leagueId: number, userId: number, playerId: number, status: string, returnDate: string, now: Date) {
  const [league] = await db.select().from(leagues).where(and(eq(leagues.id, leagueId), eq(leagues.commissionerId, userId)));
  if (!league) throw new GameError("Só o comissário pode registrar lesões");
  const [player] = await db.select({ id: players.id }).from(players).where(eq(players.id, playerId));
  if (!player) throw new GameError("Jogador não encontrado");
  await db.update(players).set({ ...injuryFromForm(status, returnDate), injurySource: status === "FIT" ? null : "MANUAL", injuryNote: null, injuryUpdatedAt: now }).where(eq(players.id, playerId));
}
