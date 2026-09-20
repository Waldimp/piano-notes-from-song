// Production-canary dispatcher. It forwards one caller-supplied receipt only;
// it never reads, lists, claims, or otherwise selects work from the queue.
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertProductionCanaryEnvironment } from "./environment-guard.mjs";

type Receipt = { dispatch_id: string; request_id: string; attempt_no: number; worker_generation: number; lease_owner: string };

// Intentionally empty until the real production-canary endpoint is reviewed.
const REVIEWED_PRODUCTION_CANARY_IDENTITIES: Array<Record<string, unknown>> = [];

const required = (name: string): string => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing ${name}`);
  return value;
};

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const hex = (bytes: Uint8Array): string => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const isCanonicalUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

const assertProductionCanary = async () => {
  if (required("PIANO_ENVIRONMENT") !== "production-canary") throw new Error("production-canary only");
  assertProductionCanaryEnvironment(Deno.env.toObject());
  const manifest = JSON.parse(required("PRODUCTION_CANARY_IDENTITY_MANIFEST")) as Record<string, unknown>;
  const expectedDigest = required("PRODUCTION_CANARY_IDENTITY_SHA256").toLowerCase();
  const digest = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(manifest)))));
  if (digest !== expectedDigest || manifest.environment !== "production-canary" || manifest.modal_environment !== "production-canary" || manifest.storage_namespace !== "_staging") throw new Error("identity mismatch");
  const supabaseUrl = required("PRODUCTION_CANARY_SUPABASE_URL");
  if (manifest.supabase_url !== supabaseUrl || manifest.modal_dispatch_url !== required("PRODUCTION_CANARY_MODAL_DISPATCH_URL")) throw new Error("endpoint is not manifest-bound");
  const projectRef = String(manifest.project_ref || "");
  const parsed = new URL(supabaseUrl);
  if (parsed.protocol !== "https:" || parsed.hostname !== `${projectRef}.supabase.co` || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error("Supabase project identity mismatch");
  const fields = ["environment", "supabase_url", "project_ref", "modal_environment", "storage_namespace", "modal_dispatch_url"];
  if (!REVIEWED_PRODUCTION_CANARY_IDENTITIES.some((entry) => fields.every((field) => entry[field] === manifest[field]))) throw new Error("production-canary identity is not in the reviewed allowlist");
};

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left[index] ^ right[index];
  return result === 0;
};

const authenticateCaller = async (request: Request, body: string): Promise<boolean> => {
  const timestamp = request.headers.get("x-production-canary-dispatch-timestamp") || "";
  const nonce = request.headers.get("x-production-canary-dispatch-nonce") || "";
  const signature = request.headers.get("x-production-canary-dispatch-signature") || "";
  const timestampNumber = Number(timestamp);
  if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(timestampNumber) || Math.abs(Date.now() - timestampNumber * 1000) > 5 * 60 * 1000 || !isCanonicalUuid(nonce) || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(required("PRODUCTION_CANARY_DISPATCH_SHARED_SECRET")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${nonce}.${body}`)));
  return sameBytes(expected, new Uint8Array(signature.match(/../g)!.map((pair) => parseInt(pair, 16))));
};

const explicitReceipt = (body: string): Receipt => {
  let value: unknown;
  try { value = JSON.parse(body); } catch { throw new Error("invalid receipt"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid receipt");
  const receipt = value as Record<string, unknown>;
  const keys = Object.keys(receipt).sort();
  const expected = ["attempt_no", "dispatch_id", "lease_owner", "request_id", "worker_generation"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index]) || !isCanonicalUuid(receipt.dispatch_id) || !isCanonicalUuid(receipt.request_id) || !Number.isSafeInteger(receipt.attempt_no) || (receipt.attempt_no as number) < 1 || !Number.isSafeInteger(receipt.worker_generation) || (receipt.worker_generation as number) < 1 || typeof receipt.lease_owner !== "string" || !/^[A-Za-z0-9._:-]{1,120}$/.test(receipt.lease_owner)) throw new Error("an explicit complete receipt is required");
  return receipt as Receipt;
};

Deno.serve(async (request) => {
  const body = await request.text();
  try {
    await assertProductionCanary();
    if (request.method !== "POST" || !(await authenticateCaller(request, body))) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    const receipt = explicitReceipt(body);
    const supabase = createClient(required("PRODUCTION_CANARY_SUPABASE_URL"), required("PRODUCTION_CANARY_SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    const nonce = request.headers.get("x-production-canary-dispatch-nonce")!;
    const signedAt = Number(request.headers.get("x-production-canary-dispatch-timestamp"));
    const { data: nonceAccepted, error: nonceError } = await supabase.rpc("consume_dispatch_auth_nonce", { p_nonce: nonce, p_expires_at: new Date(signedAt * 1000 + 5 * 60 * 1000).toISOString() });
    if (nonceError) throw nonceError;
    if (nonceAccepted !== true) return new Response(JSON.stringify({ error: "replayed_dispatch" }), { status: 409 });
    // Modal invokes reserve_production_canary_spawn transactionally before spawn.
    // This dispatcher cannot read or select a queue receipt, arm, or substitute a UUID.
    const response = await fetch(required("PRODUCTION_CANARY_MODAL_DISPATCH_URL"), {
      method: "POST",
      headers: { "content-type": "application/json", "Modal-Key": required("PRODUCTION_CANARY_MODAL_PROXY_KEY"), "Modal-Secret": required("PRODUCTION_CANARY_MODAL_PROXY_SECRET") },
      body: JSON.stringify(receipt),
    });
    if (![200, 202].includes(response.status)) return new Response(JSON.stringify({ status: response.status }), { status: response.status === 409 ? 409 : 503, headers: { "content-type": "application/json" } });
    return new Response(null, { status: 202 });
  } catch (error) {
    console.error("production-canary dispatcher failed", error instanceof Error ? error.name : "UnknownError");
    return new Response(JSON.stringify({ error: "dispatcher_failed" }), { status: 500, headers: { "content-type": "application/json" } });
  }
});
