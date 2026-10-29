import { describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import { rounds } from "@/db/schema";

describe("banco", () => {
  it("aplica as migrações num banco em memória", async () => {
    const db = await createDb({ memory: true });
    expect(await db.select().from(rounds)).toEqual([]);
  });
});
