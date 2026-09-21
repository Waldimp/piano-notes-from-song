/**
 * Authenticated create-request: validates upload ownership + duration server-side,
 * reserves a user credit, inserts request via authorize_beta_request RPC.
 * Never trusts plan/credits/duration from the client body beyond filename/path hints.
 */
import { NextResponse } from "next/server";
import { parseBuffer } from "music-metadata";

import {
  ALLOWED_AUDIO_EXTENSIONS,
  ALLOWED_AUDIO_MIME,
  MAX_UPLOAD_BYTES,
} from "@/lib/beta/limits";
import { bearerToken, requireUser, userClient } from "@/lib/server/auth";
import { wakeDispatchNext } from "@/lib/server/wake-dispatch";

export const dynamic = "force-dynamic";

type Body = {
  filename?: unknown;
  audio_path?: unknown;
};

function extensionOf(name: string): string {
  const m = name.toLowerCase().match(/\.[^.]+$/);
  return m?.[0] ?? "";
}

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

  const filename = typeof body.filename === "string" ? body.filename.trim() : "";
  const audioPath = typeof body.audio_path === "string" ? body.audio_path.trim() : "";
  if (!filename || !audioPath) {
    return NextResponse.json({ error: "filename and audio_path required" }, { status: 400 });
  }
  if (audioPath.split("/")[0] !== user.id || audioPath.includes("..")) {
    return NextResponse.json({ error: "audio_path ownership mismatch" }, { status: 403 });
  }
  const ext = extensionOf(filename);
  if (!ALLOWED_AUDIO_EXTENSIONS.has(ext)) {
    return NextResponse.json({ error: "unsupported file type", code: "invalid_type" }, { status: 400 });
  }

  const sb = userClient(token);
  const { data: blob, error: dlError } = await sb.storage.from("uploads").download(audioPath);
  if (dlError || !blob) {
    return NextResponse.json({ error: "upload not found", code: "missing_upload" }, { status: 400 });
  }
  if (blob.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "file too large", code: "too_large" }, { status: 400 });
  }
  if (blob.type && !ALLOWED_AUDIO_MIME.has(blob.type) && blob.type !== "application/octet-stream") {
    return NextResponse.json({ error: "unsupported mime type", code: "invalid_type" }, { status: 400 });
  }

  const buffer = Buffer.from(await blob.arrayBuffer());
  let duration = 0;
  try {
    const meta = await parseBuffer(buffer, { mimeType: blob.type || undefined, size: buffer.length });
    duration = Number(meta.format.duration ?? 0);
  } catch {
    return NextResponse.json({ error: "could not read audio duration", code: "bad_audio" }, { status: 400 });
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    return NextResponse.json({ error: "invalid audio duration", code: "bad_audio" }, { status: 400 });
  }

  const { data, error } = await sb.rpc("authorize_beta_request", {
    p_filename: filename,
    p_audio_path: audioPath,
    p_measured_duration_seconds: duration,
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
    plan_code?: string;
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

  // Best-effort wake — request already reserved/queued; failures leave it recoverable.
  void wakeDispatchNext().catch(() => undefined);

  return NextResponse.json({
    ok: true,
    request_id: result.request_id,
    credit_balance: result.credit_balance,
    plan_code: result.plan_code,
    measured_duration_seconds: duration,
  });
}

export async function GET() {
  return NextResponse.json({ error: "method not allowed" }, { status: 405 });
}
