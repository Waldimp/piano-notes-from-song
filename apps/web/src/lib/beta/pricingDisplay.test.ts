import { describe, expect, it } from "vitest";

import { BETA_PLANS } from "./limits";
import { BILLING_PRODUCTS } from "../billing/catalog";

describe("pricing display (beta)", () => {
  it("free plan matches marketing copy", () => {
    expect(BETA_PLANS.free.includedCredits).toBe(3);
    expect(BETA_PLANS.free.maxDurationSeconds).toBe(60);
  });

  it("mini pack catalog", () => {
    expect(BILLING_PRODUCTS.mini_pack.priceUsd).toBe(2.99);
    expect(BILLING_PRODUCTS.mini_pack.credits).toBe(5);
    expect(BILLING_PRODUCTS.mini_pack.billingType).toBe("one_time");
  });

  it("subscriptions stay off by default in catalog", () => {
    expect(BILLING_PRODUCTS.practice.checkoutEnabledByDefault).toBe(false);
    expect(BILLING_PRODUCTS.plus.checkoutEnabledByDefault).toBe(false);
  });

  it("practice and plus monthly prices", () => {
    expect(BILLING_PRODUCTS.practice.priceUsd).toBe(5.99);
    expect(BILLING_PRODUCTS.plus.priceUsd).toBe(8.99);
  });
});
