// Staging-only dispatcher. It acquires one outbox row and sends one explicit
// UUID. The function is intentionally not a public webhook.
import { createClient } from "npm:@supabase/supabase-js@2";

// This list is intentionally empty until MASTER records the real temporary
// project/endpoint identity in a reviewed change.  Environment variable names
// are never an allowlist.
const REVIEWED_STAGING_IDENTITIES: Array<Record<string, unknown>> = [];

const required = (name: string): string => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing ${name}`);
  return value;
};

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
};

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const assertStaging = async () => {
  if (required("PIANO_ENVIRONMENT") !== "staging") throw new Error("staging only");
  if (Deno.env.get("SUPABASE_URL") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
    throw new Error("legacy Supabase variables are forbidden");
  }
  const manifest = JSON.parse(required("STAGING_IDENTITY_MANIFEST")) as Record<string, unknown>;
  const expectedDigest = required("STAGING_IDENTITY_SHA256").toLowerCase();
  const digest = hex(new Uint8Array(await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(canonicalJson(manifest)),
  )));
  if (digest !== expectedDigest || manifest.environment !== "staging"
      || manifest.modal_environment !== "staging"
      || manifest.storage_namespace !== "_staging") throw new Error("identity mismatch");
  const supabaseUrl = required("STAGING_SUPABASE_URL");
  if (manifest.supabase_url !== supabaseUrl
      || manifest.modal_dispatch_url !== required("STAGING_MODAL_DISPATCH_URL")) {
    throw new Error("endpoint is not manifest-bound");
  }
  const projectRef = String(manifest.project_ref || "");
  const parsed = new URL(supabaseUrl);
  if (parsed.protocol !== "https:" || parsed.hostname !== `${projectRef}.supabase.co`
      || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Supabase project identity mismatch");
  }
  const fields = ["environment", "supabase_url", "project_ref", "modal_environment",
    "storage_namespace", "modal_dispatch_url"];
  if (!REVIEWED_STAGING_IDENTITIES.some((entry) =>
    fields.every((field) => entry[field] === manifest[field]))) {
    throw new Error("staging identity is not in the reviewed allowlist");
  }
};

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left[index] ^ right[index];
  return result === 0;
};

const authenticateCaller = async (request: Request, body: string): Promise<boolean> => {
  const timestamp = request.headers.get("x-staging-dispatch-timestamp") || "";
  const nonce = request.headers.get("x-staging-dispatch-nonce") || "";
  const signature = request.headers.get("x-staging-dispatch-signature") || "";
  const timestampNumber = Number(timestamp);
  if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(timestampNumber)
      || Math.abs(Date.now() - timestampNumber * 1000) > 5 * 60 * 1000
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nonce)
      || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(required("STAGING_DISPATCH_SHARED_SECRET")),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const expected = new Uint8Array(await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(`${timestamp}.${nonce}.${body}`),
  ));
  return sameBytes(expected, new Uint8Array(signature.match(/../g)!.map((pair) => parseInt(pair, 16))));
};

Deno.serve(async (request) => {
  const body = await request.text();
  try {
    await assertStaging();
    if (request.method !== "POST" || !(await authenticateCaller(request, body))) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }
    const generation = Number(required("WORKER_GENERATION"));
    if (!Number.isSafeInteger(generation) || generation < 1) throw new Error("invalid generation");
    const dispatcherId = `edge-${crypto.randomUUID()}`;
    const supabase = createClient(
      required("STAGING_SUPABASE_URL"), required("STAGING_SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } },
    );
    const nonce = request.headers.get("x-staging-dispatch-nonce")!;
    const signedAt = Number(request.headers.get("x-staging-dispatch-timestamp"));
    const { data: nonceAccepted, error: nonceError } = await supabase.rpc(
      "consume_dispatch_auth_nonce",
      { p_nonce: nonce, p_expires_at: new Date(signedAt * 1000 + 5 * 60 * 1000).toISOString() },
    );
    if (nonceError) throw nonceError;
    if (nonceAccepted !== true) {
      return new Response(JSON.stringify({ error: "replayed_dispatch" }), { status: 409 });
    }
    const { data, error } = await supabase.rpc("acquire_dispatch_slot", {
      p_dispatcher_id: dispatcherId, p_worker_generation: generation, p_lease_seconds: 30,
    });
    if (error) throw error;
    if (!data?.length) return new Response(null, { status: 204 });
    const receipt = { ...data[0], lease_owner: dispatcherId };
    const response = await fetch(required("STAGING_MODAL_DISPATCH_URL"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Modal-Key": required("STAGING_MODAL_PROXY_KEY"),
        "Modal-Secret": required("STAGING_MODAL_PROXY_SECRET"),
      },
      body: JSON.stringify(receipt),
    });
    if (![200, 202].includes(response.status)) {
      return new Response(JSON.stringify({ dispatch_id: receipt.dispatch_id, status: response.status }), {
        status: response.status === 409 ? 409 : 503,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ dispatch_id: receipt.dispatch_id }), {
      status: 202, headers: { "content-type": "application/json" },
    });
  } catch (error) {
    console.error("staging dispatcher failed", error instanceof Error ? error.name : "UnknownError");
    return new Response(JSON.stringify({ error: "dispatcher_failed" }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }
});
