import { describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import { createSession, deleteSession, hashPassword, login, register, userForSession, verifyPassword } from "./auth";

describe("auth", () => {
  it("guarda só o hash da senha e verifica", async () => {
    const hash = await hashPassword("segredo123");
    expect(hash).not.toContain("segredo123");
    expect(await verifyPassword("segredo123", hash)).toBe(true);
    expect(await verifyPassword("errada", hash)).toBe(false);
  });

  it("cadastra, faz login e mantém sessão", async () => {
    const db = await createDb({ memory: true });
    await register(db, { email: "Ana@Example.com", name: "Ana", password: "segredo123" });
    await expect(register(db, { email: "ana@example.com", name: "Ana", password: "segredo123" })).rejects.toThrow(/Já existe/);
    await expect(login(db, "ana@example.com", "errada")).rejects.toThrow(/incorretos/);
    const user = await login(db, "ana@example.com", "segredo123");
    const { token } = await createSession(db, user.id);
    expect((await userForSession(db, token))?.email).toBe("ana@example.com");
    await deleteSession(db, token);
    expect(await userForSession(db, token)).toBeNull();
  });
});
