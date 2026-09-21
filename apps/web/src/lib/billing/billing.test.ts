import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BILLING_PRODUCTS,
  isBillingProductCode,
  resolveProduct,
} from "./catalog";
import {
  amountsMatch,
  computeWompiWebhookHash,
  verifyWompiWebhookHash,
} from "./wompi";

const root = resolve(__dirname, "../../.."); // apps/web
const repo = resolve(root, "../..");

function readWeb(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

function readRepo(rel: string): string {
  return readFileSync(resolve(repo, rel), "utf8");
}

describe("billing catalog", () => {
  it("centralizes Mini Pack price and credits server-side", () => {
    const mini = resolveProduct("mini_pack");
    expect(mini.priceUsd).toBe(2.99);
    expect(mini.credits).toBe(5);
    expect(mini.billingType).toBe("one_time");
  });

  it("rejects unknown product codes", () => {
    expect(isBillingProductCode("mini_pack")).toBe(true);
    expect(isBillingProductCode("free")).toBe(false);
    expect(isBillingProductCode({ price: 1 })).toBe(false);
  });

  it("does not let catalog expose secrets", () => {
    const blob = JSON.stringify(BILLING_PRODUCTS);
    expect(blob).not.toMatch(/secret|client_secret|WOMPI_/i);
  });
});

describe("wompi webhook HMAC", () => {
  const secret = "test-api-secret-not-real";
  const raw = '{"IdTransaccion":"abc","Monto":2.99,"EsProductiva":false}';

  it("accepts valid HMAC over exact raw body", () => {
    const hash = computeWompiWebhookHash(raw, secret);
    expect(verifyWompiWebhookHash(raw, hash, secret)).toBe(true);
  });

  it("rejects invalid HMAC", () => {
    expect(verifyWompiWebhookHash(raw, "deadbeef", secret)).toBe(false);
  });

  it("rejects raw-body mutation", () => {
    const hash = computeWompiWebhookHash(raw, secret);
    const mutated = raw.replace("2.99", "0.01");
    expect(verifyWompiWebhookHash(mutated, hash, secret)).toBe(false);
  });

  it("matches Node HMAC-SHA256 hex format from docs", () => {
    const expected = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
    expect(computeWompiWebhookHash(raw, secret)).toBe(expected);
  });
});

describe("amount matching", () => {
  it("requires exact purchase amount", () => {
    expect(amountsMatch(2.99, 2.99)).toBe(true);
    expect(amountsMatch(2.99, 2.98)).toBe(false);
    expect(amountsMatch(2.99, null)).toBe(false);
  });
});

describe("billing trust boundaries in source", () => {
  it("checkout route only accepts product_code and requires auth", () => {
    const route = readWeb("src/app/api/billing/checkout/route.ts");
    expect(route).toContain("requireUser");
    expect(route).toContain("product_code");
    expect(route).not.toContain("price_usd");
    expect(route).not.toContain("WOMPI_CLIENT_SECRET");
  });

  it("webhook uses raw body + wompi_hash and TransaccionCompra", () => {
    const route = readWeb("src/app/api/billing/wompi/webhook/route.ts");
    const logic = readWeb("src/lib/billing/checkout.ts");
    expect(route).toContain("request.text()");
    expect(route).toContain("wompi_hash");
    expect(logic).toContain("getTransaccionCompra");
    expect(logic).toContain("settle_billing_purchase");
    expect(logic).toContain("wrong_environment");
    expect(logic).toContain("amount_mismatch");
  });

  it("migration grants credits only via settle_billing_purchase", () => {
    const sql = readRepo("migrations/supabase/0012_wompi_billing.sql");
    expect(sql).toContain("settle_billing_purchase");
    expect(sql).toContain("purchase_grant");
    expect(sql).toContain("billing_events_provider_key_unique");
    expect(sql).toContain("billing_purchases_provider_tx_unique");
    expect(sql).toContain("for select to authenticated using (user_id = auth.uid())");
    expect(sql).not.toMatch(/for insert to authenticated/i);
  });

  it("does not invent card capture / 3DS purchase path", () => {
    const wompi = readWeb("src/lib/billing/wompi.ts");
    expect(wompi).toContain("/EnlacePago");
    expect(wompi).toContain("/EnlacePagoRecurrente");
    expect(wompi).not.toContain("/TransaccionCompra/3DS");
  });

  it("create-request path remains independent of billing secrets", () => {
    const create = readWeb("src/app/api/create-request/route.ts");
    expect(create).toContain("authorize_beta_request");
    expect(create).not.toContain("WOMPI_");
  });
});
