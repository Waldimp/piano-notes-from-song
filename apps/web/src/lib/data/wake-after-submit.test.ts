import { describe, expect, it, vi } from "vitest";

import { requestImmediateDispatchWake } from "./wake-after-submit";

describe("requestImmediateDispatchWake", () => {
  it("wakes immediately after a successful create path without sending a request UUID", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer user-jwt" });
      expect(init?.body).toBeUndefined();
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const sb = {
      auth: {
        getSession: async () => ({ data: { session: { access_token: "user-jwt" } } }),
      },
    };
    await expect(requestImmediateDispatchWake(sb, fetchImpl as unknown as typeof fetch)).resolves.toBe(
      "woke",
    );
    expect(fetchImpl).toHaveBeenCalledWith("/api/wake-dispatch", expect.any(Object));
  });

  it("does not expose wake secrets on the client call", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = JSON.stringify(init?.headers ?? {});
      expect(headers).not.toMatch(/PRODUCTION_CANARY_DISPATCH_WAKE_SECRET/);
      expect(headers).not.toMatch(/wake-secret/i);
      return new Response("{}", { status: 200 });
    });
    const sb = {
      auth: {
        getSession: async () => ({ data: { session: { access_token: "user-jwt" } } }),
      },
    };
    await requestImmediateDispatchWake(sb, fetchImpl as unknown as typeof fetch);
  });

  it("treats wake HTTP failure as non-fatal (request stays recoverable)", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 502 }));
    const sb = {
      auth: {
        getSession: async () => ({ data: { session: { access_token: "user-jwt" } } }),
      },
    };
    await expect(requestImmediateDispatchWake(sb, fetchImpl as unknown as typeof fetch)).resolves.toBe(
      "failed",
    );
  });

  it("treats network errors as non-fatal", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const sb = {
      auth: {
        getSession: async () => ({ data: { session: { access_token: "user-jwt" } } }),
      },
    };
    await expect(requestImmediateDispatchWake(sb, fetchImpl as unknown as typeof fetch)).resolves.toBe(
      "failed",
    );
  });

  it("skips when there is no session token", async () => {
    const fetchImpl = vi.fn();
    const sb = {
      auth: {
        getSession: async () => ({ data: { session: null } }),
      },
    };
    await expect(requestImmediateDispatchWake(sb, fetchImpl as unknown as typeof fetch)).resolves.toBe(
      "skipped",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
