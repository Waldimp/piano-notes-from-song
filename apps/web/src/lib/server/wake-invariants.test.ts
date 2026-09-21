import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../.."); // apps/web


function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

describe("immediate wake architecture invariants", () => {
  it("cloud submit wakes after INSERT without sending a request UUID or wake secret", () => {
    const cloud = read("src/lib/data/cloud.ts");
    expect(cloud).toContain("requestImmediateDispatchWake");
    expect(cloud).toContain("void requestImmediateDispatchWake");
    expect(cloud).toMatch(/insert\([\s\S]*requestImmediateDispatchWake/);
    expect(cloud).not.toContain("PRODUCTION_CANARY_DISPATCH_WAKE_SECRET");
    expect(cloud).not.toMatch(/wake-dispatch[\s\S]*request_id/);
  });

  it("user wake route is POST-only auth and ignores privileged client selection", () => {
    const route = read("src/app/api/wake-dispatch/route.ts");
    expect(route).toContain("export async function POST");
    expect(route).toContain("requireAuthenticatedUser");
    expect(route).toContain('status: 405');
    expect(route).toContain("Ignore body entirely");
    expect(route).toContain("wakeDispatchNext");
    expect(route).toContain("publicWakeResponse");
    expect(route).not.toMatch(/body\.request_id|json\.request_id|action.*admin/);
  });

  it("cron recovery wake remains on /api/dispatch-wake with CRON_SECRET", () => {
    const cron = read("src/app/api/dispatch-wake/route.ts");
    const vercel = read("vercel.json");
    expect(cron).toContain("CRON_SECRET");
    expect(cron).toContain("wakeDispatchNext");
    expect(vercel).toContain('/api/dispatch-wake');
    expect(vercel).toContain("5 12 * * *");
  });

  it("duplicate wake cannot choose arbitrary UUID from the public endpoint", () => {
    const route = read("src/app/api/wake-dispatch/route.ts");
    const helper = read("src/lib/server/wake-dispatch.ts");
    expect(helper).toContain('action: "dispatch_next"');
    expect(route).not.toContain("acquire_production_canary_dispatch");
    expect(helper).not.toMatch(/request_id:/);
  });
});
