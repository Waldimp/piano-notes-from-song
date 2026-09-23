/**
 * Daily Vercel Cron: subscription reconciliation (snapshot sync only).
 * Auth: CRON_SECRET Bearer. Never accepts client subscription ids to mutate.
 */
import { NextResponse } from "next/server";

import { runSubscriptionReconciliation } from "@/lib/billing/runSubscriptionReconciliation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const result = await runSubscriptionReconciliation({ limit: 100 });
  return NextResponse.json({
    ok: result.ok,
    metrics: result.metrics,
    note: "No charges initiated; unverifiable pagosRealizados deltas never grant credits",
  });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
