import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getWakeDispatchConfig,
  publicWakeResponse,
  wakeDispatchNext,
} from "./wake-dispatch";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("wake-dispatch server helper", () => {
  it("requires server env and never returns the wake secret", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("PRODUCTION_CANARY_DISPATCH_WAKE_SECRET", "super-secret-wake-value-32chars!!");
    const config = getWakeDispatchConfig();
    expect(config.ok).toBe(true);
    if (!config.ok) return;
    const serialized = JSON.stringify(publicWakeResponse({ ok: true, status: 200, result: { status: "accepted" } }));
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain(config.wakeSecret);
    expect(publicWakeResponse({ ok: true, status: 200, result: { request_id: "x" } })).toEqual({
      ok: true,
    });
  });

  it("wakeDispatchNext posts dispatch_next with Bearer wake secret only on the outbound call", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("PRODUCTION_CANARY_DISPATCH_WAKE_SECRET", "server-only-wake-secret-xxxxxxxxxxxx");
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer server-only-wake-secret-xxxxxxxxxxxx",
      });
      expect(init?.body).toBe(JSON.stringify({ action: "dispatch_next" }));
      return new Response(JSON.stringify({ status: "idle", reason: "no_eligible_dispatch" }), {
        status: 200,
      });
    });
    const result = await wakeDispatchNext(fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(publicWakeResponse(result))).not.toContain("server-only-wake-secret");
  });

  it("reports misconfiguration without leaking secrets", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("PRODUCTION_CANARY_SUPABASE_URL", "");
    vi.stubEnv("PRODUCTION_CANARY_DISPATCH_WAKE_SECRET", "");
    const config = getWakeDispatchConfig();
    expect(config.ok).toBe(false);
  });
});
