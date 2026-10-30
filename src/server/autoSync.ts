import { getDb } from "@/db/client";
import { getProvider } from "@/providers";
import { runScheduledJobs } from "./jobs";

/**
 * Sincronização automática dentro do próprio servidor (sem cron externo): a cada N minutos roda o
 * mesmo ciclo do /api/cron — calendário, estatísticas pós-jogo, fechamento de rodada e waivers.
 * Os próprios jobs decidem o que precisa rodar, então chamadas frequentes não repetem trabalho.
 */
const state = ((globalThis as { __uclAutoSync?: { timer: ReturnType<typeof setInterval> | null; running: boolean } }).__uclAutoSync ??= {
  timer: null,
  running: false,
});

async function tick() {
  if (state.running) return;
  state.running = true;
  try {
    const db = await getDb();
    const results = await runScheduledJobs({ db, provider: await getProvider(db), now: new Date() });
    const failed = Object.entries(results).filter(([, r]) => !r.ok);
    if (failed.length) console.warn(`[auto-sync] com erros: ${failed.map(([k, r]) => `${k}: ${r.message}`).join(" | ")}`);
  } catch (error) {
    console.warn("[auto-sync] falhou:", error instanceof Error ? error.message : error);
  } finally {
    state.running = false;
  }
}

export function startAutoSync(minutes: number) {
  if (state.timer || minutes <= 0) return;
  console.log(`[auto-sync] sincronizando a cada ${minutes} min`);
  // Primeira rodada logo após a subida, sem atrasar o servidor.
  setTimeout(() => void tick(), 15_000);
  state.timer = setInterval(() => void tick(), minutes * 60_000);
}
