import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { BILLING_PRODUCTS, resolveProduct } from "./catalog";
import {
  assertSubscriptionProduct,
  buildPeriodKey,
  expectedPeriodCredits,
  expectedPeriodPriceUsd,
  isSubscriptionProductCode,
  mapWompiEstadoSuscripcion,
  subscriptionLifecycleHardBlock,
} from "./subscriptions";

const root = resolve(__dirname, "../../..");
const repo = resolve(root, "../..");

function readWeb(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

function readRepo(rel: string): string {
  return readFileSync(resolve(repo, rel), "utf8");
}

describe("Practice / Plus catalog (server-owned)", () => {
  it("Practice is $5.99 / 20 credits / monthly", () => {
    const p = resolveProduct("practice");
    expect(p.priceUsd).toBe(5.99);
    expect(p.credits).toBe(20);
    expect(p.periodDays).toBe(30);
    expect(p.billingType).toBe("subscription");
    expect(expectedPeriodCredits("practice")).toBe(20);
    expect(expectedPeriodPriceUsd("practice")).toBe(5.99);
  });

  it("Plus is $8.99 / 50 credits / monthly", () => {
    const p = resolveProduct("plus");
    expect(p.priceUsd).toBe(8.99);
    expect(p.credits).toBe(50);
    expect(p.periodDays).toBe(30);
    expect(expectedPeriodCredits("plus")).toBe(50);
    expect(expectedPeriodPriceUsd("plus")).toBe(8.99);
  });

  it("rejects non-subscription product codes for affiliation", () => {
    expect(isSubscriptionProductCode("mini_pack")).toBe(false);
    expect(assertSubscriptionProduct("mini_pack").ok).toBe(false);
    expect(assertSubscriptionProduct("nope").ok).toBe(false);
    expect(assertSubscriptionProduct("practice").ok).toBe(true);
    expect(assertSubscriptionProduct("plus").ok).toBe(true);
  });

  it("frontend catalog blob does not embed secrets or client price overrides", () => {
    const blob = JSON.stringify(BILLING_PRODUCTS);
    expect(blob).not.toMatch(/WOMPI_CLIENT_SECRET|api.secret/i);
  });
});

describe("period grant idempotency keys (internal)", () => {
  it("builds stable period keys for duplicate protection", () => {
    expect(buildPeriodKey({ periodStartIso: "2026-09-21T12:00:00.000Z" })).toBe(
      "2026-09-21"
    );
    expect(
      buildPeriodKey({
        periodStartIso: "2026-09-21T12:00:00.000Z",
        externalTransactionId: "tx-1",
      })
    ).toBe("2026-09-21:tx-1");
  });

  it("maps EstadoSuscripcion with official support labels", () => {
    expect(mapWompiEstadoSuscripcion(0).label).toBe("active");
    expect(mapWompiEstadoSuscripcion(1).label).toBe("suspended");
    expect(mapWompiEstadoSuscripcion(2).known).toBe(true);
    expect(mapWompiEstadoSuscripcion(undefined).raw).toBeNull();
  });
});

describe("subscription lifecycle HARD BLOCK", () => {
  it("blocks affiliation when subscriptions flag is off", () => {
    const prev = process.env.BILLING_SUBSCRIPTIONS_ENABLED;
    try {
      delete process.env.BILLING_SUBSCRIPTIONS_ENABLED;
      const block = subscriptionLifecycleHardBlock("disabled");
      expect(block.ok).toBe(false);
      expect(block.code).toBe("subscriptions_disabled");
    } finally {
      if (prev === undefined) delete process.env.BILLING_SUBSCRIPTIONS_ENABLED;
      else process.env.BILLING_SUBSCRIPTIONS_ENABLED = prev;
    }
  });

  it("blocks individual cancel explicitly", () => {
    const block = subscriptionLifecycleHardBlock("cancel_unsupported");
    expect(block.code).toBe("individual_cancel_unsupported");
    expect(block.status).toBe(501);
    expect(block.gaps.some((g) => /cancel/i.test(g))).toBe(true);
  });
});

describe("subscription API / SQL trust boundaries", () => {
  it("subscription route requires auth and never trusts client price/credits", () => {
    const route = readWeb("src/app/api/billing/subscription/route.ts");
    expect(route).toContain("requireUser");
    expect(route).toContain("product_code");
    expect(route).not.toContain("price_usd");
    expect(route).not.toMatch(/credits:\s*\d/);
    expect(route).toContain("cancel_unsupported");
    expect(route).toContain("cancel_supported: false");
    expect(route).toContain("createSubscriptionCheckout");
  });

  it("pricing UI keeps Practice/Plus buttons disabled", () => {
    const page = readWeb("src/app/pricing/page.tsx");
    expect(page).toContain("Coming soon");
    expect(page).toContain("Practice");
    expect(page).toContain("Plus");
    expect(page).toMatch(/disabled[\s\S]*Coming soon/);
    expect(page).not.toContain('startCheckout("practice")');
    expect(page).not.toContain('startCheckout("plus")');
  });

  it("account has no self-serve cancel until Wompi docs confirm", () => {
    const page = readWeb("src/app/account/page.tsx");
    expect(page).not.toContain("Manage / Cancel");
    expect(page).toContain("subscriptionsEnabled");
    expect(page).toMatch(/Cancelación individual|próximamente|contáctanos/i);
  });

  it("migration 0013 adds period grants + grant RPC without authenticated writes", () => {
    const sql = readRepo("migrations/supabase/0013_wompi_subscriptions.sql");
    expect(sql).toContain("billing_subscription_period_grants");
    expect(sql).toContain("grant_subscription_period_credits");
    expect(sql).toContain("subscription_grant");
    expect(sql).toContain("already_granted");
    expect(sql).toContain("for select to authenticated using (user_id = auth.uid())");
    expect(sql).not.toMatch(/for insert to authenticated/i);
    expect(sql).not.toMatch(/for update to authenticated/i);
  });

  it("migration 0015 expands statuses and dedicated_enlace", () => {
    const sql = readRepo("migrations/supabase/0015_subscription_status_reconcile.sql");
    expect(sql).toContain("suspended");
    expect(sql).toContain("finished");
    expect(sql).toContain("dedicated_enlace");
    expect(sql).toContain("reconciliation_status");
  });

  it("wompi adapter exposes confirmed recurrent endpoints only", () => {
    const wompi = readWeb("src/lib/billing/wompi.ts");
    expect(wompi).toContain("/EnlacePagoRecurrente");
    expect(wompi).toContain("/suscripciones");
    expect(wompi).toContain("listEnlacePagoRecurrenteSuscripciones");
    expect(wompi).toContain("disableEnlacePagoRecurrente");
    expect(wompi).toContain("MUST NOT be used as per-user cancel");
  });

  it("webhook settles subscriptions via IdSuscripcion and keeps Mini Pack path", () => {
    const logic = readWeb("src/lib/billing/checkout.ts");
    expect(logic).toContain("settle_billing_purchase");
    expect(logic).toContain("processVerifiedSubscriptionPayment");
    expect(logic).toContain("IdentificadorEnlaceComercio");
    expect(logic).toContain("IdSuscripcion");
  });
});
