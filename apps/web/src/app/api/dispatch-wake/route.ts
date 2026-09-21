/**
 * Cron / operator recovery wake for general Modal dispatch.
 * Auth: CRON_SECRET Bearer. Never accepts a client UUID.
 * Daily Hobby cron is the safety net; interactive wake is /api/wake-dispatch.
 */
import { NextResponse } from "next/server";

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

  return NextResponse.json(
    { ok: result.ok, status: result.status, result: result.result },
    { status: result.ok ? 200 : 502 },
  );
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
