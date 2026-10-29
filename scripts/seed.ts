/**
 * Seed de desenvolvimento — mock (DATA_PROVIDER=mock) ou replay de temporada encerrada (API_FOOTBALL_REPLAY=true):
 * - rodada 1 completa (18 jogos com estatísticas finais) e a rodada 2 nos próximos dias;
 * - 6 usuários demo (senha: demo12345) e uma liga demo pronta para o draft.
 * Rode com o `npm run dev` parado (PGlite aceita um processo por vez).
 */
import { eq } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { defaultMockAnchor, getProvider, isReplay, MOCK_ANCHOR_KEY, providerName } from "../src/providers";
import { hashPassword } from "../src/server/auth";
import { runScheduledJobs } from "../src/server/jobs";
import { createLeague, joinLeague } from "../src/server/leagues";
import { setSetting } from "../src/server/settings";

if (providerName() !== "mock" && !isReplay()) {
  console.error("O seed só roda com DATA_PROVIDER=mock ou com API_FOOTBALL_REPLAY=true (temporada encerrada).");
  process.exit(1);
}
const db = await createDb();
const now = new Date();
if (providerName() === "mock") await setSetting(db, MOCK_ANCHOR_KEY, defaultMockAnchor(now).toISOString());
else console.log("Replay: buscando calendário e a rodada 1 na API-Football (~20 requisições, ~2 min)…");
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
