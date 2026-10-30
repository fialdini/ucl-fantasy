/** Roda uma vez quando o servidor Next sobe. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Padrão: liga com dados reais (UEFA). AUTO_SYNC_MINUTES=0 desliga; com cron externo, desnecessário.
  const fallback = process.env.DATA_PROVIDER === "uefa" ? 15 : 0;
  const minutes = Number(process.env.AUTO_SYNC_MINUTES ?? fallback);
  if (minutes > 0) {
    const { startAutoSync } = await import("./server/autoSync");
    startAutoSync(minutes);
  }
}
