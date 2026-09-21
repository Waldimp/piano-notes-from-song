/**
 * Server-only wake of the Modal control plane.
 * Never import this from client components — it reads wake secrets from env.
 */

export const DISPATCH_FUNCTION = "dispatch-modal-staging";

export type WakeDispatchResult = {
  ok: boolean;
  status: number;
  result: unknown;
};

export function getWakeDispatchConfig():
  | { ok: true; supabaseUrl: string; wakeSecret: string }
  | { ok: false; error: string } {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.PRODUCTION_CANARY_SUPABASE_URL;
  const wakeSecret = process.env.PRODUCTION_CANARY_DISPATCH_WAKE_SECRET;
  if (!supabaseUrl || !wakeSecret) {
    return { ok: false, error: "dispatch wake no configurado" };
  }
  return { ok: true, supabaseUrl, wakeSecret };
}

/** Invoke Edge Function dispatch_next. Secrets stay on the server. */
export async function wakeDispatchNext(
  fetchImpl: typeof fetch = fetch,
): Promise<WakeDispatchResult> {
  const config = getWakeDispatchConfig();
  if (!config.ok) {
    return { ok: false, status: 500, result: { error: config.error } };
  }

  const endpoint = `${config.supabaseUrl.replace(/\/$/, "")}/functions/v1/${DISPATCH_FUNCTION}`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.wakeSecret}`,
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

  return {
    ok: response.ok,
    status: response.status,
    result: payload,
  };
}

/** Public JSON for user wake — never echoes secrets or privileged IDs. */
export function publicWakeResponse(result: WakeDispatchResult): { ok: boolean } {
  return { ok: result.ok };
}
