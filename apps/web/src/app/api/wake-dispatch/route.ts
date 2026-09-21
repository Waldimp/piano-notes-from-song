/**
 * Authenticated user wake after a successful web upload.
 * POST only. No request_id / UUID / admin params — control plane selects work.
 * Best-effort from the client: upload success must not depend on this route.
 */
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { publicWakeResponse, wakeDispatchNext } from "@/lib/server/wake-dispatch";

export const dynamic = "force-dynamic";

async function requireAuthenticatedUser(request: Request): Promise<boolean> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ") || auth.length < 20) return false;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return false;

  const token = auth.slice("Bearer ".length).trim();
  if (!token || token.toLowerCase() === "undefined" || token.toLowerCase() === "null") {
    return false;
  }

  const sb = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.auth.getUser(token);
  return !error && Boolean(data.user?.id);
}

export async function POST(request: Request) {
  if (!(await requireAuthenticatedUser(request))) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  // Ignore body entirely: clients must not select work or pass admin actions.
  try {
    await request.text();
  } catch {
    /* empty */
  }

  try {
    const result = await wakeDispatchNext();
    const body = publicWakeResponse(result);
    return NextResponse.json(body, { status: result.ok ? 200 : 502 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "method not allowed" }, { status: 405 });
}
