import { mkdirSync } from "node:fs";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

const migrationsFolder = path.join(process.cwd(), "drizzle");

/**
 * Sem DATABASE_URL: Postgres embutido (PGlite) — zero instalação. Mock e API usam pastas separadas
 * (./.data/pglite, ./.data/pglite-api e ./.data/pglite-uefa) para dados fictícios e reais nunca se misturarem.
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
  // Serverless não tem disco persistente: sem DATABASE_URL os dados sumiriam a cada instância.
  if (!options.memory && process.env.VERCEL) throw new Error("DATABASE_URL não configurada (obrigatória na Vercel)");
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  let client;
  if (options.memory) client = new PGlite();
  else {
    const folder = { "api-football": "pglite-api", uefa: "pglite-uefa" }[process.env.DATA_PROVIDER ?? ""] ?? "pglite";
    const dataDir = process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), ".data", folder);
    mkdirSync(dataDir, { recursive: true });
    client = new PGlite(dataDir);
  }
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
