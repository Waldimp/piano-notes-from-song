/**
 * Unlock a FREE preview: create a full-length request for the same upload.
 * Auth required. The credit/plan decision is enforced by authorize_beta_request
 * (a FREE plan would only get another preview, so we refuse early with
 * upgrade_required). Never trusts a client-supplied audio_path.
 */
import { NextResponse } from "next/server";

import { bearerToken, requireUser, serviceClient, userClient } from "@/lib/server/auth";
import { wakeDispatchNext } from "@/lib/server/wake-dispatch";

export const dynamic = "force-dynamic";

type Body = { song_id?: unknown };

export async function POST(request: Request) {
  const user = await requireUser(request);
  const token = bearerToken(request);
  if (!user || !token) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const songId = typeof body.song_id === "string" ? body.song_id.trim() : "";
  if (!songId || songId.length > 200) {
    return NextResponse.json({ error: "song_id required" }, { status: 400 });
  }

  const sb = userClient(token);

  // RLS: only the owner's song is visible.
  const { data: song } = await sb
    .from("songs")
    .select("id,request_id,preview_seconds,filename,title")
    .eq("id", songId)
    .maybeSingle();
  if (!song) {
    return NextResponse.json({ error: "song not found", code: "not_found" }, { status: 404 });
  }
  if (!song.preview_seconds) {
    return NextResponse.json({ error: "song is already full", code: "already_full" }, { status: 400 });
  }

  const { data: usage } = await sb.rpc("get_my_usage");
  const planCode = (usage as { plan_code?: string } | null)?.plan_code ?? "free";
  const balance = Number((usage as { credit_balance?: number } | null)?.credit_balance ?? 0);
  if (planCode === "free") {
    return NextResponse.json(
      { error: "upgrade required", code: "upgrade_required", plan_code: planCode },
      { status: 402 },
    );
  }
  if (balance < 1) {
    return NextResponse.json({ error: "no credits", code: "no_credits", credit_balance: 0 }, { status: 402 });
  }

  const { data: original } = await sb
    .from("requests")
    .select("audio_path,filename,measured_duration_seconds")
    .eq("id", song.request_id)
    .maybeSingle();
  if (!original?.audio_path || !original.measured_duration_seconds) {
    return NextResponse.json({ error: "original upload unknown", code: "missing_upload" }, { status: 400 });
  }

  // The upload must still exist (previews are retained 30 days for this purpose).
  const admin = serviceClient();
  const folder = original.audio_path.split("/").slice(0, -1).join("/");
  const objectName = original.audio_path.split("/").pop();
  const { data: objects } = await admin.storage.from("uploads").list(folder, { search: objectName });
  if (!objects?.some((o) => o.name === objectName)) {
    return NextResponse.json(
      { error: "original upload expired", code: "upload_expired" },
      { status: 410 },
    );
  }

  const { data, error } = await sb.rpc("authorize_beta_request", {
    p_filename: original.filename || song.filename,
    p_audio_path: original.audio_path,
    p_measured_duration_seconds: original.measured_duration_seconds,
  });
  if (error) {
    return NextResponse.json({ error: error.message, code: "authorize_failed" }, { status: 400 });
  }
  const result = data as {
    ok?: boolean;
    code?: string;
    message?: string;
    request_id?: string;
    credit_balance?: number;
    preview_seconds?: number | null;
  };
  if (!result?.ok) {
    const status =
      result?.code === "no_credits" || result?.code === "duration_exceeded"
        ? 402
        : result?.code === "rate_limited" || result?.code === "active_limit"
          ? 429
          : 400;
    return NextResponse.json(result, { status });
  }
  if (result.preview_seconds) {
    // Defensive: the plan changed under us and produced another preview.
    return NextResponse.json({ ok: true, request_id: result.request_id, still_preview: true });
  }

  void wakeDispatchNext().catch(() => undefined);

  return NextResponse.json({
    ok: true,
    request_id: result.request_id,
    credit_balance: result.credit_balance,
  });
}

export async function GET() {
  return NextResponse.json({ error: "method not allowed" }, { status: 405 });
}
