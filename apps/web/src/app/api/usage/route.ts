import { NextResponse } from "next/server";

import { bearerToken, requireUser, userClient } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await requireUser(request);
  const token = bearerToken(request);
  if (!user || !token) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }
  const sb = userClient(token);
  const { data, error } = await sb.rpc("get_my_usage");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, usage: data });
}
