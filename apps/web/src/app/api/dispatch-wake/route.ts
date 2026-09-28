/**
 * Cron / operator recovery wake for general Modal dispatch + daily maintenance.
 * Auth: CRON_SECRET Bearer. Never accepts a client UUID.
 *
 * Wake sources (fastest first): create-request server wake, the browser while
 * a song is queued, pg_cron every minute when the outbox has work (0017), and
 * this daily Vercel cron as the last safety net. The same daily run also
 * deletes expired uploads (see lib/server/cleanup-uploads).
 */
import { NextResponse } from "next/server";

import { cleanupExpiredUploads } from "@/lib/server/cleanup-uploads";
import { wakeDispatchNext } from "@/lib/server/wake-dispatch";

export const dynamic = "force-dynamic";

async function handle(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const result = await wakeDispatchNext();
  if (result.status === 500 && !result.ok) {
    return NextResponse.json(
      { error: (result.result as { error?: string })?.error ?? "dispatch wake no configurado" },
      { status: 500 },
    );
  }

  // Maintenance is best-effort and only on the daily/operator path (GET);
  // pg_cron wakes use POST every minute and must stay cheap.
  let cleanup: unknown = null;
  if (request.method === "GET") {
    try {
      cleanup = await cleanupExpiredUploads();
    } catch (e) {
      cleanup = { error: e instanceof Error ? e.message : "cleanup failed" };
    }
  }

  return NextResponse.json(
    { ok: result.ok, status: result.status, result: result.result, cleanup },
    { status: result.ok ? 200 : 502 },
  );
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
