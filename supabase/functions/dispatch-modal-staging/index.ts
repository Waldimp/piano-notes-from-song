// Production Modal dispatcher (historical slug: dispatch-modal-staging).
// Two authenticated modes:
// 1) action=dispatch_next — control plane leases one eligible outbox UUID
// 2) explicit receipt forward — legacy canary-compatible passthrough
// Modal never polls Supabase; this function never accepts a client-chosen UUID
// without going through acquire_next_modal_dispatch.
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertProductionCanaryEnvironment } from "./environment-guard.mjs";

type Receipt = {
  dispatch_id: string;
  request_id: string;
  attempt_no: number;
  worker_generation: number;
  lease_owner: string;
};

const DISPATCHER_ID = "edge:dispatch-modal-staging";

const REVIEWED_PRODUCTION_CANARY_IDENTITIES: Array<Record<string, unknown>> = [{
  environment: "production-canary",
  supabase_url: "https://epapmenfnyfqdfmsgfee.supabase.co",
  project_ref: "epapmenfnyfqdfmsgfee",
  modal_environment: "production-canary",
  storage_namespace: "_staging",
  modal_dispatch_url: "https://waltermejia61-production-canary--piano-controlled-worker-a7a7df.modal.run",
}];

const required = (name: string): string => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing ${name}`);
  return value;
};

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const hex = (bytes: Uint8Array): string => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const isCanonicalUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

const assertProductionCanary = async () => {
  if (required("PIANO_ENVIRONMENT") !== "production-canary") throw new Error("production-canary only");
  assertProductionCanaryEnvironment(Deno.env.toObject());
  const manifest = JSON.parse(required("PRODUCTION_CANARY_IDENTITY_MANIFEST")) as Record<string, unknown>;
  const expectedDigest = required("PRODUCTION_CANARY_IDENTITY_SHA256").toLowerCase();
  const digest = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(manifest)))));
  if (
    digest !== expectedDigest
    || manifest.environment !== "production-canary"
    || manifest.modal_environment !== "production-canary"
    || manifest.storage_namespace !== "_staging"
  ) throw new Error("identity mismatch");
  const supabaseUrl = required("PRODUCTION_CANARY_SUPABASE_URL");
  if (
    manifest.supabase_url !== supabaseUrl
    || manifest.modal_dispatch_url !== required("PRODUCTION_CANARY_MODAL_DISPATCH_URL")
  ) throw new Error("endpoint is not manifest-bound");
  const projectRef = String(manifest.project_ref || "");
  const parsed = new URL(supabaseUrl);
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== `${projectRef}.supabase.co`
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) throw new Error("Supabase project identity mismatch");
  const fields = ["environment", "supabase_url", "project_ref", "modal_environment", "storage_namespace", "modal_dispatch_url"];
  if (!REVIEWED_PRODUCTION_CANARY_IDENTITIES.some((entry) => fields.every((field) => entry[field] === manifest[field]))) {
    throw new Error("production-canary identity is not in the reviewed allowlist");
  }
};

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left[index] ^ right[index];
  return result === 0;
};

const authenticateHmac = async (request: Request, body: string): Promise<boolean> => {
  const timestamp = request.headers.get("x-production-canary-dispatch-timestamp") || "";
  const nonce = request.headers.get("x-production-canary-dispatch-nonce") || "";
  const signature = request.headers.get("x-production-canary-dispatch-signature") || "";
  const timestampNumber = Number(timestamp);
  if (
    !/^\d+$/.test(timestamp)
    || !Number.isSafeInteger(timestampNumber)
    || Math.abs(Date.now() - timestampNumber * 1000) > 5 * 60 * 1000
    || !isCanonicalUuid(nonce)
    || !/^[0-9a-f]{64}$/i.test(signature)
  ) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(required("PRODUCTION_CANARY_DISPATCH_SHARED_SECRET")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${nonce}.${body}`)),
  );
  return sameBytes(expected, new Uint8Array(signature.match(/../g)!.map((pair) => parseInt(pair, 16))));
};

const authenticateWake = async (request: Request): Promise<boolean> => {
  const wakeSecret = Deno.env.get("PRODUCTION_CANARY_DISPATCH_WAKE_SECRET");
  if (!wakeSecret) return false;
  const auth = request.headers.get("authorization") || "";
  const expected = `Bearer ${wakeSecret}`;
  const left = new TextEncoder().encode(auth);
  const right = new TextEncoder().encode(expected);
  return sameBytes(left, right);
};

const explicitReceipt = (body: string): Receipt => {
  let value: unknown;
  try { value = JSON.parse(body); } catch { throw new Error("invalid receipt"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid receipt");
  const receipt = value as Record<string, unknown>;
  const keys = Object.keys(receipt).sort();
  const expected = ["attempt_no", "dispatch_id", "lease_owner", "request_id", "worker_generation"];
  if (
    keys.length !== expected.length
    || keys.some((key, index) => key !== expected[index])
    || !isCanonicalUuid(receipt.dispatch_id)
    || !isCanonicalUuid(receipt.request_id)
    || !Number.isSafeInteger(receipt.attempt_no)
    || (receipt.attempt_no as number) < 1
    || !Number.isSafeInteger(receipt.worker_generation)
    || (receipt.worker_generation as number) < 1
    || typeof receipt.lease_owner !== "string"
    || !/^[A-Za-z0-9._:-]{1,120}$/.test(receipt.lease_owner)
  ) throw new Error("an explicit complete receipt is required");
  return receipt as Receipt;
};

const isDispatchNext = (body: string): boolean => {
  if (!body) return true;
  try {
    const value = JSON.parse(body) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const keys = Object.keys(value).sort();
    return keys.length === 1 && keys[0] === "action" && value.action === "dispatch_next";
  } catch {
    return false;
  }
};

const supabaseClient = () => createClient(
  required("PRODUCTION_CANARY_SUPABASE_URL"),
  required("PRODUCTION_CANARY_SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

const forwardToModal = async (receipt: Receipt): Promise<Response> => {
  const response = await fetch(required("PRODUCTION_CANARY_MODAL_DISPATCH_URL"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Modal-Key": required("PRODUCTION_CANARY_MODAL_PROXY_KEY"),
      "Modal-Secret": required("PRODUCTION_CANARY_MODAL_PROXY_SECRET"),
    },
    body: JSON.stringify(receipt),
  });
  if (![200, 202].includes(response.status)) {
    return new Response(JSON.stringify({ status: response.status }), {
      status: response.status === 409 ? 409 : 503,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify({
    status: "accepted",
    dispatch_id: receipt.dispatch_id,
    request_id: receipt.request_id,
  }), { status: 202, headers: { "content-type": "application/json" } });
};

const consumeNonce = async (supabase: ReturnType<typeof supabaseClient>, request: Request): Promise<Response | null> => {
  const nonce = request.headers.get("x-production-canary-dispatch-nonce");
  const signedAt = Number(request.headers.get("x-production-canary-dispatch-timestamp"));
  if (!nonce || !Number.isFinite(signedAt)) return null;
  const { data: nonceAccepted, error: nonceError } = await supabase.rpc("consume_dispatch_auth_nonce", {
    p_nonce: nonce,
    p_expires_at: new Date(signedAt * 1000 + 5 * 60 * 1000).toISOString(),
  });
  if (nonceError) throw nonceError;
  if (nonceAccepted !== true) {
    return new Response(JSON.stringify({ error: "replayed_dispatch" }), { status: 409 });
  }
  return null;
};

const dispatchNext = async (supabase: ReturnType<typeof supabaseClient>): Promise<Response> => {
  const { data, error } = await supabase.rpc("acquire_next_modal_dispatch", {
    p_dispatcher_id: DISPATCHER_ID,
    p_lease_seconds: 30,
  });
  if (error) throw error;
  const rows = Array.isArray(data) ? data : (data ? [data] : []);
  if (rows.length === 0) {
    return new Response(JSON.stringify({ status: "idle", reason: "no_eligible_dispatch" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  const row = rows[0] as Record<string, unknown>;
  const receipt: Receipt = {
    dispatch_id: String(row.dispatch_id),
    request_id: String(row.request_id),
    attempt_no: Number(row.attempt_no),
    worker_generation: Number(row.worker_generation),
    lease_owner: String(row.lease_owner || DISPATCHER_ID),
  };
  if (
    !isCanonicalUuid(receipt.dispatch_id)
    || !isCanonicalUuid(receipt.request_id)
    || !Number.isSafeInteger(receipt.attempt_no)
    || receipt.attempt_no < 1
    || !Number.isSafeInteger(receipt.worker_generation)
    || receipt.worker_generation < 1
  ) throw new Error("acquired receipt is invalid");
  return await forwardToModal(receipt);
};

Deno.serve(async (request) => {
  const body = await request.text();
  try {
    await assertProductionCanary();
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }

    const wakeOk = await authenticateWake(request);
    const hmacOk = wakeOk ? false : await authenticateHmac(request, body);
    if (!wakeOk && !hmacOk) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }

    const supabase = supabaseClient();
    if (hmacOk) {
      const replay = await consumeNonce(supabase, request);
      if (replay) return replay;
    }

    if (wakeOk || isDispatchNext(body)) {
      // Wake auth may only select via acquire_next_modal_dispatch.
      // HMAC callers may also request dispatch_next; they still cannot pass a UUID.
      if (wakeOk && body && !isDispatchNext(body) && body !== "{}") {
        return new Response(JSON.stringify({ error: "wake_requires_dispatch_next" }), { status: 400 });
      }
      return await dispatchNext(supabase);
    }

    const receipt = explicitReceipt(body);
    // Legacy explicit receipt path: Modal validates lease/ownership via
    // reserve_dispatch_spawn; this dispatcher never arms or invents UUIDs.
    return await forwardToModal(receipt);
  } catch (error) {
    console.error("production dispatcher failed", error instanceof Error ? error.name : "UnknownError");
    return new Response(JSON.stringify({ error: "dispatcher_failed" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
