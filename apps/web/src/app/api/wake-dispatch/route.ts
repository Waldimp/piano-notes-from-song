/**
 * Authenticated user wake after a successful web upload.
 * POST only. No request_id / UUID / admin params — control plane selects work.
 */
import { NextResponse } from "next/server";

import { bearerToken, requireUser, userClient } from "@/lib/server/auth";
import { publicWakeResponse, wakeDispatchNext } from "@/lib/server/wake-dispatch";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await requireUser(request);
  const token = bearerToken(request);
  if (!user || !token) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  try {
    await request.text();
  } catch {
    /* empty */
  }

  try {
    const sb = userClient(token);
    const { data: allowed } = await sb.rpc("check_beta_rate_limit", {
      p_user_id: user.id,
      p_action: "wake_dispatch",
    });
    if (allowed === false) {
      return NextResponse.json({ ok: false, code: "rate_limited" }, { status: 429 });
    }
  } catch {
    // If rate-limit infra is unavailable, still attempt wake (beta safety net).
  }

  try {
    const result = await wakeDispatchNext();
    return NextResponse.json(publicWakeResponse(result), { status: result.ok ? 200 : 502 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "method not allowed" }, { status: 405 });
}
