// Backtest: projeta as rodadas 2 e 3 só com jogos anteriores e compara com o real. Pare o `npm run dev` antes (PGlite). ALL=1 inclui quem não jogou.
import { eq } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { playerMatchStats } from "../src/db/schema";
import { projectRound } from "../src/server/projections";

const db = await createDb();
const all = await db.select().from(playerMatchStats);
const corr = (a: number[], b: number[]) => {
  const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i]! - ma) * (b[i]! - mb); saa += (a[i]! - ma) ** 2; sbb += (b[i]! - mb) ** 2; }
  return sab / Math.sqrt(saa * sbb);
};
for (const round of [2, 3]) {
  const proj = await projectRound(db, round, { ignoreAvailability: true });
  const actual = all.filter((s) => s.roundOrder === round && (process.env.ALL === "1" || s.minutes > 0));
  const pred: number[] = [], real: number[] = [], base: number[] = [];
  for (const s of actual) {
    const p = proj.get(s.playerId);
    if (!p) continue;
    const mine = all.filter((x) => x.playerId === s.playerId && x.roundOrder < round && x.minutes > 0);
    pred.push(p.points); real.push(s.points);
    base.push(mine.length ? mine.reduce((a, x) => a + x.points, 0) / mine.length : 0);
  }
  const mae = (a: number[]) => a.reduce((s, v, i) => s + Math.abs(v - real[i]!), 0) / a.length;
  const bias = pred.reduce((s, v, i) => s + v - real[i]!, 0) / pred.length;
  console.log(`R${round} n=${pred.length} modelo MAE ${mae(pred).toFixed(2)} corr ${corr(pred, real).toFixed(2)} bias ${bias.toFixed(2)} | média do jogador MAE ${mae(base).toFixed(2)} corr ${corr(base, real).toFixed(2)}`);
}
process.exit(0);
