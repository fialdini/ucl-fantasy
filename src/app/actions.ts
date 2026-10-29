"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { game } from "@config/game";
import { advanceSimulationClock, getProvider, isSimulated } from "@/providers";
import { createSession, deleteSession, login, register } from "@/server/auth";
import { GameError } from "@/server/errors";
import { recalcPoints, reprocessRound, runScheduledJobs, withSyncLog } from "@/server/jobs";
import {
  addFreeAgent,
  cancelWaiverClaim,
  createLeague,
  createWaiverClaim,
  joinLeague,
  setLineup,
  startDraft,
} from "@/server/leagues";
import { roundsState } from "@/web/queries";
import { requireMember, requireUser, SESSION_COOKIE } from "@/web/session";

const str = (form: FormData, key: string) => String(form.get(key) ?? "");
const int = (form: FormData, key: string) => Number.parseInt(str(form, key), 10);

type Outcome = string | { to: string } | void;

/**
 * Executa a ação. Erro de regra volta para `path` com a mensagem;
 * sucesso vai para `{ to }` ou volta para `path` com a mensagem de ok.
 */
async function run(path: string, fn: () => Promise<Outcome>): Promise<never> {
  let outcome: Outcome;
  try {
    outcome = await fn();
  } catch (error) {
    if (error instanceof GameError) redirect(`${path}?error=${encodeURIComponent(error.message)}`);
    throw error;
  }
  if (typeof outcome === "object") redirect(outcome.to);
  redirect(outcome ? `${path}?ok=${encodeURIComponent(outcome)}` : path);
}

async function startSession(userId: number) {
  const db = await getDb();
  const { token, expiresAt } = await createSession(db, userId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}

export async function registerAction(form: FormData) {
  await run("/register", async () => {
    const user = await register(await getDb(), { email: str(form, "email"), name: str(form, "name"), password: str(form, "password") });
    await startSession(user.id);
    return { to: "/leagues" };
  });
}

export async function loginAction(form: FormData) {
  await run("/login", async () => {
    const user = await login(await getDb(), str(form, "email"), str(form, "password"));
    await startSession(user.id);
    return { to: "/leagues" };
  });
}

export async function logoutAction() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(await getDb(), token);
  store.delete(SESSION_COOKIE);
  redirect("/login");
}

export async function createLeagueAction(form: FormData) {
  const user = await requireUser();
  await run("/leagues", async () => {
    const league = await createLeague(await getDb(), {
      userId: user.id,
      name: str(form, "name"),
      teamName: str(form, "teamName"),
      maxTeams: int(form, "maxTeams"),
    });
    return { to: `/leagues/${league.id}` };
  });
}

export async function joinLeagueAction(form: FormData) {
  const user = await requireUser();
  await run("/leagues", async () => {
    const league = await joinLeague(await getDb(), { userId: user.id, code: str(form, "code"), teamName: str(form, "teamName") });
    return { to: `/leagues/${league.id}` };
  });
}

export async function startDraftAction(form: FormData) {
  const leagueId = int(form, "leagueId");
  const { user, db } = await requireMember(leagueId);
  await run(`/leagues/${leagueId}`, async () => {
    await startDraft(db, leagueId, user.id, new Date());
    return { to: `/leagues/${leagueId}/draft` };
  });
}

export async function setLineupAction(form: FormData) {
  const leagueId = int(form, "leagueId");
  const { user, db } = await requireMember(leagueId);
  const starters = form.getAll("starter").map((v) => Number(v));
  await run(`/leagues/${leagueId}/team`, async () => {
    await setLineup(db, leagueId, user.id, starters, new Date());
    return "Escalação salva";
  });
}

export async function freeAgentAction(form: FormData) {
  const leagueId = int(form, "leagueId");
  const { user, db } = await requireMember(leagueId);
  await run(`/leagues/${leagueId}/market`, async () => {
    await addFreeAgent(db, leagueId, user.id, int(form, "addPlayerId"), int(form, "dropPlayerId"), new Date());
    return "Contratação concluída";
  });
}

export async function waiverClaimAction(form: FormData) {
  const leagueId = int(form, "leagueId");
  const { user, db } = await requireMember(leagueId);
  await run(`/leagues/${leagueId}/market`, async () => {
    await createWaiverClaim(db, leagueId, user.id, int(form, "addPlayerId"), int(form, "dropPlayerId"), new Date());
    return "Pedido de waiver registrado";
  });
}

export async function cancelClaimAction(form: FormData) {
  const leagueId = int(form, "leagueId");
  const { user, db } = await requireMember(leagueId);
  await run(`/leagues/${leagueId}/market`, async () => {
    await cancelWaiverClaim(db, leagueId, user.id, int(form, "claimId"));
    return "Pedido cancelado";
  });
}

// ---------- Painel do comissário ----------

async function requireCommissioner(form: FormData) {
  const leagueId = int(form, "leagueId");
  const member = await requireMember(leagueId);
  if (!member.isCommissioner) redirect(`/leagues/${leagueId}`);
  return { ...member, leagueId, path: `/leagues/${leagueId}/admin` };
}

export async function syncNowAction(form: FormData) {
  const { db, path } = await requireCommissioner(form);
  await run(path, async () => {
    const now = new Date();
    const results = await runScheduledJobs({ db, provider: await getProvider(db), now }, { forceCalendar: true });
    const failed = Object.entries(results).filter(([, r]) => !r.ok);
    return failed.length ? `Sincronizado com erros: ${failed.map(([k]) => k).join(", ")}` : "Sincronização concluída";
  });
}

export async function reprocessRoundAction(form: FormData) {
  const { db, path } = await requireCommissioner(form);
  const order = int(form, "round");
  await run(path, async () => {
    const ctx = { db, provider: await getProvider(db), now: new Date() };
    const r = await withSyncLog(ctx, `reprocess-round-${order}`, () => reprocessRound(ctx, order));
    return r.message;
  });
}

export async function recalcPointsAction(form: FormData) {
  const { db, path } = await requireCommissioner(form);
  await run(path, async () => {
    const ctx = { db, provider: await getProvider(db), now: new Date() };
    const r = await withSyncLog(ctx, "recalc-points", () => recalcPoints(db));
    return r.message;
  });
}

/**
 * Mock/replay: adianta o relógio da temporada até a rodada vigente ter terminado e passado o prazo
 * de correção — a sincronização seguinte pontua e fecha a rodada.
 */
export async function advanceRoundAction(form: FormData) {
  const { db, path } = await requireCommissioner(form);
  await run(path, async () => {
    if (!isSimulated()) throw new GameError("Disponível só no mock ou no replay de temporada encerrada");
    const now = new Date();
    const { current } = await roundsState(db, now);
    if (!current?.lastKickoff) throw new GameError("Sem rodada para jogar — sincronize o calendário");
    const closesAt = current.lastKickoff.getTime() + (game.sync.matchDurationMinutes + game.sync.closeDelayHours * 60 + 5) * 60_000;
    // Em dias inteiros, para os jogos manterem o horário original.
    if (closesAt > now.getTime()) await advanceSimulationClock(db, Math.ceil((closesAt - now.getTime()) / 86_400_000) * 86_400_000);
    const results = await runScheduledJobs({ db, provider: await getProvider(db), now }, { forceCalendar: true });
    return results.close?.message ?? `${current.name} jogada`;
  });
}
