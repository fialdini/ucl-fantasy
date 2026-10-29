/** Aplica as migrações (createDb já migra; útil no deploy). */
import { createDb } from "../src/db/client";

await createDb();
console.log("Migrações aplicadas.");
process.exit(0);
