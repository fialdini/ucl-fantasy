import { and, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { fantasyTeams, players, rosterSlots } from "@/db/schema";
import { normalizeSlots } from "@/domain/roster";
import { GameError } from "./errors";

type Via = (typeof rosterSlots.$inferInsert)["acquiredVia"];

/**
 * Tira `drop` e coloca `add` no elenco do time, depois reorganiza titulares/banco
 * (quem chega tem prioridade para a vaga de titular da mesma posição).
 * O índice único (liga, jogador) impede que um jogador fique em dois times.
 */
export async function moveRoster(
  db: DbOrTx,
  input: { leagueId: number; teamId: number; add?: readonly number[]; drop?: readonly number[]; via: Via; now: Date },
) {
  const add = input.add ?? [];
  const drop = input.drop ?? [];
  if (drop.length) {
    await db.delete(rosterSlots).where(and(eq(rosterSlots.teamId, input.teamId), inArray(rosterSlots.playerId, [...drop])));
  }
  if (add.length) {
    try {
      await db.insert(rosterSlots).values(
        add.map((playerId) => ({ leagueId: input.leagueId, teamId: input.teamId, playerId, slot: "BENCH" as const, acquiredVia: input.via, acquiredAt: input.now })),
      );
    } catch {
      throw new GameError("Jogador já pertence a outro time");
    }
  }
  await normalizeTeamSlots(db, input.teamId, new Set(add));
}

export async function normalizeTeamSlots(db: DbOrTx, teamId: number, preferred: ReadonlySet<number> = new Set()) {
  const roster = await db
    .select({ playerId: rosterSlots.playerId, position: players.position, slot: rosterSlots.slot })
    .from(rosterSlots)
    .innerJoin(players, eq(players.id, rosterSlots.playerId))
    .where(eq(rosterSlots.teamId, teamId));
  const [team] = await db.select({ formation: fantasyTeams.formation }).from(fantasyTeams).where(eq(fantasyTeams.id, teamId));
  for (const [playerId, slot] of normalizeSlots(roster, preferred, team?.formation)) {
    if (roster.find((p) => p.playerId === playerId)?.slot === slot) continue;
    await db.update(rosterSlots).set({ slot }).where(and(eq(rosterSlots.teamId, teamId), eq(rosterSlots.playerId, playerId)));
  }
}
