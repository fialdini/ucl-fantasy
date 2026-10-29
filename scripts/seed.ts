/**
 * Seed de desenvolvimento (DATA_PROVIDER=mock):
 * - temporada simulada com a rodada 1 completa (18 jogos com estatísticas finais) e a rodada 2 em 2 dias;
 * - 6 usuários demo (senha: demo12345) e uma liga demo pronta para o draft.
 * Rode com o `npm run dev` parado (PGlite aceita um processo por vez).
 */
import { eq } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { defaultMockAnchor, getProvider, MOCK_ANCHOR_KEY, providerName } from "../src/providers";
import { hashPassword } from "../src/server/auth";
import { runScheduledJobs } from "../src/server/jobs";
import { createLeague, joinLeague } from "../src/server/leagues";
import { setSetting } from "../src/server/settings";

if (providerName() !== "mock") {
  console.error("O seed usa dados mockados: rode com DATA_PROVIDER=mock.");
  process.exit(1);
}
const db = await createDb();
const now = new Date();
await setSetting(db, MOCK_ANCHOR_KEY, defaultMockAnchor(now).toISOString());
const results = await runScheduledJobs({ db, provider: await getProvider(db), now });
for (const [job, r] of Object.entries(results)) console.log(`${r.ok ? "✅" : "❌"} ${job}: ${r.message}`);

const password = await hashPassword("demo12345");
const ids: number[] = [];
for (let i = 1; i <= 6; i++) {
  const email = `demo${i}@ucl.dev`;
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  const user = existing ?? (await db.insert(users).values({ email, name: `Demo ${i}`, passwordHash: password }).returning())[0]!;
  ids.push(user.id);
}
const league = await createLeague(db, { userId: ids[0]!, name: "Liga Demo", teamName: "Demo FC 1", maxTeams: 6 });
for (let i = 1; i < ids.length; i++) await joinLeague(db, { userId: ids[i]!, code: league.inviteCode, teamName: `Demo FC ${i + 1}` });
console.log(`\nLiga Demo criada (código ${league.inviteCode}). Entre com demo1@ucl.dev / demo12345 e inicie o draft.`);
process.exit(0);
