/**
 * Valida a chave e o plano da API-Football antes de usar dados reais.
 *   npx tsx --env-file=.env.local scripts/check-api.ts
 * Consome 1 requisição (/fixtures) + 1 opcional (detalhe de uma partida encerrada). /status não conta na cota.
 */
import { mapFixtures, mapMatchDetails } from "../src/providers/apiFootball/mapper";

const key = process.env.API_FOOTBALL_KEY;
const season = process.env.API_FOOTBALL_SEASON ?? "2026";
const league = process.env.API_FOOTBALL_LEAGUE_ID ?? "2";
if (!key) {
  console.error("Defina API_FOOTBALL_KEY em .env.local");
  process.exit(1);
}

async function get(path: string) {
  const res = await fetch(`https://v3.football.api-sports.io${path}`, { headers: { "x-apisports-key": key! } });
  const body = (await res.json()) as { errors: unknown; response: unknown };
  return { body, remaining: res.headers.get("x-ratelimit-requests-remaining") };
}

const status = await get("/status");
console.log("Conta:", JSON.stringify((status.body.response as { subscription?: unknown; requests?: unknown }) ?? {}, null, 2));

const fixtures = await get(`/fixtures?league=${league}&season=${season}`);
if (Array.isArray(fixtures.body.errors) ? fixtures.body.errors.length : Object.keys(fixtures.body.errors ?? {}).length) {
  console.error("❌ Erro ao listar partidas (plano sem acesso à temporada?):", fixtures.body.errors);
  process.exit(1);
}
const mapped = mapFixtures(fixtures.body.response);
const perRound = new Map<number, number>();
for (const f of mapped) perRound.set(f.roundOrder, (perRound.get(f.roundOrder) ?? 0) + 1);
console.log(`✅ ${mapped.length} partidas mapeadas. Por rodada:`, Object.fromEntries(perRound));

const finished = mapped.find((f) => f.status === "FINISHED");
if (finished) {
  const detail = await get(`/fixtures?ids=${finished.id}`);
  const [m] = mapMatchDetails(detail.body.response);
  const withMinutes = m?.players.filter((p) => p.minutes > 0).length ?? 0;
  console.log(`✅ Partida ${finished.id}: ${m?.players.length ?? 0} jogadores, ${withMinutes} com minutos, ${m?.goals.length ?? 0} gols na linha do tempo.`);
  const gk = m?.players.find((p) => p.saves > 0);
  console.log(gk ? `✅ Defesas presentes (ex.: ${gk.name}: ${gk.saves})` : "⚠️  Nenhum jogador com defesas — verifique o plano.");
  if (withMinutes === 0) console.log("❌ Sem estatística por jogador nesta partida: o plano não serve para o jogo.");
}
console.log("Requisições restantes hoje:", fixtures.remaining);
