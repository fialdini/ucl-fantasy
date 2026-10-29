/**
 * Roda o ciclo agendado uma vez (mesmo que /api/cron).
 * Com PGlite (sem DATABASE_URL), pare o `npm run dev` antes: o banco embutido aceita um processo por vez.
 */
import { createDb } from "../src/db/client";
import { getProvider } from "../src/providers";
import { runScheduledJobs } from "../src/server/jobs";

const db = await createDb();
const results = await runScheduledJobs({ db, provider: await getProvider(db), now: new Date() });
for (const [job, r] of Object.entries(results)) console.log(`${r.ok ? "✅" : "❌"} ${job}: ${r.message}`);
process.exit(0);
