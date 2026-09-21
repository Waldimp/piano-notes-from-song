import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../.."); // apps/web

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

describe("immediate wake + beta create-request invariants", () => {
  it("cloud submit uses create-request API without wake secret or client UUID selection", () => {
    const cloud = read("src/lib/data/cloud.ts");
    expect(cloud).toContain("/api/create-request");
    expect(cloud).toContain("${userData.user.id}/");
    expect(cloud).not.toContain("PRODUCTION_CANARY_DISPATCH_WAKE_SECRET");
    expect(cloud).not.toMatch(/\.from\("requests"\)\s*\.insert/);
  });

  it("create-request validates duration server-side and wakes without exposing secrets", () => {
    const route = read("src/app/api/create-request/route.ts");
    expect(route).toContain("parseBuffer");
    expect(route).toContain("authorize_beta_request");
    expect(route).toContain("wakeDispatchNext");
    expect(route).not.toContain("PRODUCTION_CANARY_DISPATCH_WAKE_SECRET");
    expect(JSON.stringify(route)).not.toMatch(/plan_code.*body/);
  });

  it("user wake route is POST-only auth and rate-limited", () => {
    const route = read("src/app/api/wake-dispatch/route.ts");
    expect(route).toContain("export async function POST");
    expect(route).toContain("requireUser");
    expect(route).toContain("check_beta_rate_limit");
    expect(route).toContain("status: 405");
  });

  it("cron recovery wake remains on /api/dispatch-wake with CRON_SECRET", () => {
    const cron = read("src/app/api/dispatch-wake/route.ts");
    const vercel = read("vercel.json");
    expect(cron).toContain("CRON_SECRET");
    expect(cron).toContain("wakeDispatchNext");
    expect(vercel).toContain("/api/dispatch-wake");
    expect(vercel).toContain("5 12 * * *");
  });
});
