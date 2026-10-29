# UCL Fantasy

Fantasy head-to-head da UEFA Champions League (formato NFL Fantasy): ligas privadas de 6 a 12 times, draft snake ao vivo, confrontos a cada rodada da Champions e pontuação calculada a partir das estatísticas reais de cada partida.

Aplicação web (Next.js) que roda no Chrome, no desktop e no celular, sem instalação.

## Rodar localmente

Requer Node 24 (ver `.nvmrc`). Não precisa de Docker nem de Postgres: sem `DATABASE_URL`, o app usa PGlite, um Postgres embutido salvo em `.data/pglite`.

```bash
npm install
cp .env.example .env.local      # DATA_PROVIDER=mock por padrão
npm run db:seed                 # temporada simulada + 6 usuários demo + "Liga Demo"
npm run dev                     # http://localhost:3000
```

Entre com `demo1@ucl.dev` / `demo12345` (comissário da Liga Demo) e clique em **Iniciar draft**. Os outros 5 times não escolhem, então ganham auto-pick a cada 60 s. Para testar mais rápido, use `DRAFT_PICK_SECONDS=2 npm run dev`.

No painel **Comissário**, o botão **Simulação: jogar …** adianta a temporada simulada. Com isso, a rodada seguinte é jogada, pontuada e fechada, e a janela de waiver abre.

> O PGlite aceita **um processo por vez**. Pare o `npm run dev` antes de rodar `db:seed` ou `sync`. Para recomeçar do zero, apague `.data/`.

## Testes

```bash
npm test          # domínio, providers, ciclo completo (banco em memória)
npm run typecheck
```

Os testes unitários cobrem pontuação, ordem do snake, resolução de waivers, travamento de escalação, resultado de confronto e fechamento de rodada. O teste `tests/cycle.test.ts` percorre o ciclo inteiro com o provider mock: sincronização, draft, trava, rodada, fechamento e waiver. Ele também cobre o caso de dados oficiais atrasados.

## Dados reais (API-Football)

1. Crie uma conta em https://dashboard.api-football.com e copie a chave.
2. Em `.env.local`: `DATA_PROVIDER=api-football`, `API_FOOTBALL_KEY=...` e `API_FOOTBALL_SEASON=2026`.
3. Valide o plano: `npm run check:api`. O script verifica se a temporada atual está liberada e se as partidas trazem estatística por jogador e defesas. Há relatos de que o plano grátis não dá acesso à temporada corrente; nesse caso, é preciso um plano pago.

### Replay de temporada encerrada (plano grátis)

O plano grátis só acessa as temporadas de 2022 a 2024 e não aceita o parâmetro `ids`. Para testar com jogadores e estatísticas reais, use a Champions 2024/25, que já tem o formato de 36 clubes:

```
DATA_PROVIDER=api-football
API_FOOTBALL_SEASON=2024
API_FOOTBALL_REPLAY=true
API_FOOTBALL_BATCH_IDS=false
```

Depois rode `npm run db:seed` (cerca de 20 requisições) e `npm run dev`.

- **Datas:** o replay desloca as datas em dias inteiros, deixando a rodada 1 encerrada e a rodada 2 nos próximos dias. Partidas futuras aparecem sem placar.
- **Elencos:** saem das súmulas já reveladas. Jogadores novos entram quando aparecem numa súmula.
- **Botão "Simulação: jogar …"** no painel do comissário: adianta o relógio até a rodada vigente terminar, e a sincronização pontua e fecha. Custa 1 requisição por partida nova (18 na fase de liga, cerca de 2 min por causa do limite de 10 por minuto).
- **Cache:** dados históricos ficam em cache para sempre, então reprocessar não gasta requisições.
- **Banco separado:** os modos de API usam `.data/pglite-api`, separado do mock (`.data/pglite`).

**Consumo por rodada da fase de liga (18 jogos):**

| Chamada | Requisições |
|---|---|
| Calendário (`/fixtures?league&season`) | 1 a cada sync com jogo em andamento (cache de 30 min) |
| Estatísticas pós-jogo (`/fixtures?ids=`, até 20 por chamada) | 1 |
| Reprocessamento no fechamento | 1 |
| Elencos (`/players/squads`, 36 clubes) | 36 por dia |
| Classificação (`/standings`) | 1 após a rodada 8 |

Com cron a cada 30 min, uma semana de rodada fica em cerca de 60–100 requisições. Todas as respostas vão para a tabela `api_cache`. Recalcular pontos usa as estatísticas salvas e não chama a API.

A fonte é isolada na interface `FootballDataProvider` ([src/providers/types.ts](src/providers/types.ts)). Para trocar de fornecedor, basta escrever outra implementação.

## Regras e configuração

- Tabela de pontuação: [config/scoring.ts](config/scoring.ts). Depois de alterá-la, use **Recalcular pontos (sem API)** no painel do comissário.
- Elenco, draft, calendário, playoffs e waivers: [config/game.ts](config/game.ts).

**Decisões do MVP:**

- **Escalação:** trava no início do primeiro jogo da rodada e é congelada (snapshot). Ela só destrava no fechamento da rodada.
- **Pontos:** ficam "parciais" logo depois de cada jogo e viram "finais" no fechamento. O fechamento acontece 24 h após o último jogo e rebusca todas as partidas, porque a fonte corrige dados depois do jogo. Partida encerrada sem estatística oficial aparece como **"Aguardando dados oficiais"** e segura o fechamento da rodada.
- **Gols sofridos e clean sheet:** calculados pela linha do tempo de gols, contando só os gols sofridos enquanto o jogador estava em campo.
- **Calendário fantasy:** a temporada regular vai da rodada de início da liga até a volta do playoff (rodada 10). Os playoffs reúnem o top 4: semifinal nas oitavas (ida + volta) e final nas quartas (ida + volta). Semi e final da Champions ficam fora, porque com posse exclusiva não sobram jogadores ativos.
- **Repescagem de elenco:** após as rodadas 8 e 10, a janela de waiver roda em ordem snake (inversa à classificação, 1 troca por time por volta, invertendo a cada volta). Depois da fase de liga, o limite por clube sobe de 3 para 4.
- **Trocas:** waiver e free agent são sempre da mesma posição. A janela de waiver dura 24 h após o fechamento; depois disso, a contratação é imediata (free agency) até a próxima trava.
- **Jogadores:** a chave é o ID da API. Quem some de todos os elencos fica inativo. Transferências atualizam o clube.

## Deploy (Vercel + Postgres)

1. Crie um Postgres (Neon ou Supabase) e configure `DATABASE_URL` na Vercel. As migrações rodam na primeira conexão, ou com `npm run db:migrate`.
2. Configure também `DATA_PROVIDER`, `API_FOOTBALL_*` e `CRON_SECRET`.
3. Job agendado: [.github/workflows/sync.yml](.github/workflows/sync.yml) chama `/api/cron` a cada 30 min. Ele precisa dos secrets `APP_URL` e `CRON_SECRET` no GitHub.

## Fora do MVP

Trocas entre usuários, formações flexíveis, substituição automática, atualização ao vivo durante os jogos, notificações e app nativo. A sala de draft usa polling com o servidor como autoridade do tempo; a mesma rota pode virar SSE/WebSocket. O mesmo vale para placares ao vivo: basta rodar o sync de estatísticas também com partidas em andamento.
