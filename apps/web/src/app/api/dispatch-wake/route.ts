/**
 * Control-plane wake for general Modal dispatch.
 * Vercel Cron (or an operator) calls this route; it never accepts a client UUID.
 * It asks the Edge Function to lease the next eligible outbox row and forward it.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DISPATCH_FUNCTION = "dispatch-modal-staging";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.PRODUCTION_CANARY_SUPABASE_URL;
  const wakeSecret = process.env.PRODUCTION_CANARY_DISPATCH_WAKE_SECRET;
  if (!supabaseUrl || !wakeSecret) {
    return NextResponse.json({ error: "dispatch wake no configurado" }, { status: 500 });
  }

  const endpoint = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/${DISPATCH_FUNCTION}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${wakeSecret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action: "dispatch_next" }),
  });

  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: "[non-json]" };
  }

  return NextResponse.json(
    { ok: response.ok, status: response.status, result: payload },
    { status: response.ok ? 200 : 502 },
  );
}

export async function POST(request: Request) {
  return GET(request);
}
