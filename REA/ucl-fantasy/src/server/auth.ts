import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { GameError } from "./errors";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function register(db: Db, input: { email: string; name: string; password: string }) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new GameError("E-mail inválido");
  if (input.password.length < 8) throw new GameError("A senha precisa ter pelo menos 8 caracteres");
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) throw new GameError("Já existe uma conta com este e-mail");
  const [user] = await db
    .insert(users)
    .values({ email, name: input.name.trim() || email.split("@")[0]!, passwordHash: await hashPassword(input.password) })
    .returning();
  return user!;
}

export async function login(db: Db, email: string, password: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  if (!user || !(await verifyPassword(password, user.passwordHash))) throw new GameError("E-mail ou senha incorretos");
  return user;
}

export async function createSession(db: Db, userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ tokenHash: tokenHash(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function userForSession(db: Db, token: string) {
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash(token)), gt(sessions.expiresAt, new Date())));
  return row ?? null;
}

export async function deleteSession(db: Db, token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash(token)));
}
