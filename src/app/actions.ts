"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
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
  dropPlayer,
  joinLeague,
  setFormation,
  setLineup,
  moveToSlot,
  swapPlayers,
  updateLeagueSettings,
  startDraft,
} from "@/server/leagues";
import { setPlayerInjury } from "@/server/injuries";
import { setManager } from "@/server/manager";
import { acceptTrade, approveTrade, cancelTrade, proposeTrade, rejectTrade, vetoTrade } from "@/server/trades";
import { formatDate } from "@/web/ui";
import { roundsState } from "@/web/queries";
import { requireMember, requireUser, SESSION_COOKIE } from "@/web/session";

const str = (form: FormData, key: string) => String(form.get(key) ?? "");
const int = (form: FormData, key: string) => Number.parseInt(str(form, key), 10);
/** Campo opcional: vazio = null. */
const optInt = (form: FormData, key: string) => (str(form, key) ? int(form, key) : null);
const ints = (form: FormData, key: string) => form.getAll(key).map((v) => Number(v)).filter(Number.isFinite);

type Outcome = string | { to: string } | void;
const sep = (path: string) => (path.includes("?") ? "&" : "?");

/**
 * Executa a ação. Erro de regra volta para `path` com a mensagem;
 * sucesso vai para `{ to }` ou volta para `path` com a mensagem de ok.
 */
async function run(path: string, fn: () => Promise<Outcome>): Promise<never> {
  let outcome: Outcome;
  try {
    outcome = await fn();
    // Ações mudam dados mostrados nos layouts (status da liga, contador de trocas): atualiza tudo.
    revalidatePath("/", "layout");
  } catch (error) {
    if (error instanceof GameError) redirect(`${path}${sep(path)}error=${encodeURIComponent(error.message)}`);
    throw error;
  }
  if (typeof outcome === "object") redirect(outcome.to);
  redirect(outcome ? `${path}${sep(path)}ok=${encodeURIComponent(outcome)}` : path);
}

async function startSession(userId: number) {
  const db = await getDb();
  const { token, expiresAt } = await createSession(db, userId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Só HTTPS quando o acesso é HTTPS (túnel/hospedagem). Pela rede local/VPN o acesso é HTTP.
    secure: (await headers()).get("x-forwarded-proto") === "https",
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
    await addFreeAgent(db, leagueId, user.id, int(form, "addPlayerId"), optInt(form, "dropPlayerId"), new Date());
    return "Contratação concluída";
  });
}

export async function waiverClaimAction(form: FormData) {
  const leagueId = int(form, "leagueId");
  const { user, db } = await requireMember(leagueId);
  await run(`/leagues/${leagueId}/market`, async () => {
    await createWaiverClaim(db, leagueId, user.id, int(form, "addPlayerId"), optInt(form, "dropPlayerId"), new Date());
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

/** Caminho de volta informado pelo formulário (só dentro da própria liga). */
const backTo = (form: FormData, leagueId: number, fallback: string) => {
  const to = str(form, "returnTo");
  return to.startsWith(`/leagues/${leagueId}/`) ? to : `/leagues/${leagueId}/${fallback}`;
};

export async function dropPlayerAction(form: FormData) {
  const leagueId = int(form, "leagueId");
  const { user, db } = await requireMember(leagueId);
  await run(backTo(form, leagueId, "market"), async () => {
    await dropPlayer(db, leagueId, user.id, int(form, "playerId"), new Date());
    return "Jogador dispensado: agora há uma vaga no elenco";
  });
}

// ---------- Trocas ----------

export async function setFormationAction(form: FormData) {
  const leagueId = int(form, "leagueId");
  const { user, db } = await requireMember(leagueId);
  await run(`/leagues/${leagueId}/team`, async () => {
    await setFormation(db, leagueId, user.id, str(form, "formation"), new Date());
    return `Formação ${str(form, "formation")} aplicada: confira os titulares`;
  });
}

/** Arrastar no campinho: troca titular e reserva sem recarregar a página por redirecionamento. */
export async function swapPlayersAction(leagueId: number, aId: number, bId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user, db } = await requireMember(leagueId);
  try {
    await swapPlayers(db, leagueId, user.id, aId, bId, new Date());
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    if (error instanceof GameError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function moveToSlotAction(leagueId: number, playerId: number, slot: "STARTER" | "BENCH"): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user, db } = await requireMember(leagueId);
  try {
    await moveToSlot(db, leagueId, user.id, playerId, slot, new Date());
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    if (error instanceof GameError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function setManagerAction(form: FormData) {
  const leagueId = int(form, "leagueId");
  const { user, db } = await requireMember(leagueId);
  const coachId = optInt(form, "coachId");
  await run(backTo(form, leagueId, "market"), async () => {
    await setManager(db, leagueId, user.id, coachId, new Date());
    return coachId === null ? "Técnico dispensado" : "Técnico contratado";
  });
}

export async function setInjuryAction(form: FormData) {
  const leagueId = int(form, "leagueId");
  const { user, db } = await requireMember(leagueId);
  await run(backTo(form, leagueId, "market"), async () => {
    await setPlayerInjury(db, leagueId, user.id, int(form, "playerId"), str(form, "status"), str(form, "returnDate"), new Date());
    return "Situação do jogador atualizada";
  });
}

export async function proposeTradeAction(form: FormData) {
  const leagueId = int(form, "leagueId");
  const receiverTeamId = int(form, "receiverTeamId");
  const { user, db } = await requireMember(leagueId);
  await run(`/leagues/${leagueId}/trades?with=${receiverTeamId}`, async () => {
    await proposeTrade(
      db,
      { leagueId, userId: user.id, receiverTeamId, givePlayerIds: ints(form, "give"), getPlayerIds: ints(form, "get"), message: str(form, "message") },
      new Date(),
    );
    return { to: `/leagues/${leagueId}/trades?ok=${encodeURIComponent("Proposta enviada")}` };
  });
}

export async function respondTradeAction(form: FormData) {
  const leagueId = int(form, "leagueId");
  const tradeId = int(form, "tradeId");
  const { user, db } = await requireMember(leagueId);
  await run(`/leagues/${leagueId}/trades`, async () => {
    const now = new Date();
    switch (str(form, "decision")) {
      case "accept": {
        const r = await acceptTrade(db, leagueId, user.id, tradeId, now);
        return r.status === "REVIEW"
          ? `Troca aceita! Ela fica em revisão do comissário até ${formatDate(r.reviewEndsAt)} e depois é concluída`
          : "Troca concluída! Os jogadores já estão nos novos elencos";
      }
      case "reject":
        await rejectTrade(db, leagueId, user.id, tradeId, now);
        return "Proposta recusada";
      default:
        await cancelTrade(db, leagueId, user.id, tradeId, now);
        return "Proposta cancelada";
    }
  });
}

// ---------- Painel do comissário ----------

async function requireCommissioner(form: FormData) {
  const leagueId = int(form, "leagueId");
  const member = await requireMember(leagueId);
  if (!member.isCommissioner) redirect(`/leagues/${leagueId}`);
  return { ...member, leagueId, path: `/leagues/${leagueId}/admin` };
}

export async function updateSettingsAction(form: FormData) {
  const { db, path, user, leagueId } = await requireCommissioner(form);
  await run(path, async () => {
    const unit = Number(str(form, "pickUnit")) || 1;
    await updateLeagueSettings(
      db,
      leagueId,
      user.id,
      { draftPickSeconds: Math.round(Number(str(form, "pickValue")) * unit), tradeReviewHours: int(form, "tradeReviewHours") },
      new Date(),
    );
    return "Configurações salvas";
  });
}

/** Simulação: 1 s por escolha (inicia o draft se ainda não começou). Os auto-picks correm na sala de draft. */
export async function simulateDraftAction(form: FormData) {
  const { db, path, user, leagueId, league } = await requireCommissioner(form);
  await run(path, async () => {
    const now = new Date();
    if (league.status !== "SETUP" && league.status !== "DRAFTING") throw new GameError("O draft já terminou");
    await updateLeagueSettings(db, leagueId, user.id, { draftPickSeconds: 1 }, now);
    if (league.status === "SETUP") await startDraft(db, leagueId, user.id, now);
    return { to: `/leagues/${leagueId}/draft` };
  });
}

export async function commissionerTradeAction(form: FormData) {
  const { db, path, user, leagueId } = await requireCommissioner(form);
  const tradeId = int(form, "tradeId");
  await run(path, async () => {
    const now = new Date();
    if (str(form, "decision") === "approve") {
      await approveTrade(db, leagueId, user.id, tradeId, now);
      return "Troca aprovada e concluída";
    }
    await vetoTrade(db, leagueId, user.id, tradeId, str(form, "reason"), now);
    return "Troca vetada";
  });
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
    const r = await withSyncLog(ctx, "recalc-points", () => recalcPoints(ctx));
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
