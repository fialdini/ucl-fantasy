import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { appSettings } from "@/db/schema";

export async function getSetting<T>(db: DbOrTx, key: string): Promise<T | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  return (row?.value as T | undefined) ?? null;
}

export async function setSetting(db: DbOrTx, key: string, value: unknown): Promise<void> {
  await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
}
