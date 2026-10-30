import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { getProvider } from "@/providers";
import { runScheduledJobs } from "@/server/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Job agendado (GitHub Actions / Vercel Cron): `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const db = await getDb();
  const results = await runScheduledJobs({ db, provider: await getProvider(db), now: new Date() });
  return NextResponse.json(results);
}
