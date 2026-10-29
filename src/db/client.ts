import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

const migrationsFolder = path.join(process.cwd(), "drizzle");

/**
 * Sem DATABASE_URL: Postgres embutido (PGlite) em ./.data/pglite — zero instalação.
 * Com DATABASE_URL: Postgres real (produção).
 * `memory: true` cria um banco efêmero (testes).
 */
export async function createDb(options: { memory?: boolean; url?: string } = {}): Promise<Db> {
  const url = options.memory ? undefined : (options.url ?? process.env.DATABASE_URL);
  if (url) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const db = drizzle(postgres(url, { max: 5, prepare: false }), { schema });
    await migrate(db, { migrationsFolder });
    return db as unknown as Db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = options.memory ? new PGlite() : new PGlite(path.join(process.cwd(), ".data", "pglite"));
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

const globalForDb = globalThis as unknown as { __uclDb?: Promise<Db> };

/** Conexão única por processo (sobrevive ao hot reload do Next). */
export function getDb(): Promise<Db> {
  globalForDb.__uclDb ??= createDb();
  return globalForDb.__uclDb;
}
