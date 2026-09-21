/**
 * Server-side product catalog for Wompi billing.
 * Mirrors public.billing_products; SQL is enforcement source of truth for prices.
 */
export const BILLING_PRODUCTS = {
  mini_pack: {
    productCode: "mini_pack",
    displayName: "Mini Pack",
    billingType: "one_time" as const,
    priceUsd: 2.99,
    currency: "USD" as const,
    credits: 5,
    planCode: "mini",
    periodDays: null,
    /** Checkout via POST /EnlacePago when Wompi credentials + BILLING_ENABLED. */
    checkoutEnabledByDefault: true,
  },
  practice: {
    productCode: "practice",
    displayName: "Practice",
    billingType: "subscription" as const,
    priceUsd: 5.99,
    currency: "USD" as const,
    credits: 20,
    planCode: "practice",
    periodDays: 30,
    /**
     * SUBSCRIPTIONS PARTIALLY READY — shared EnlacePagoRecurrente APIs exist;
     * checkout stays off until webhook↔subscriber correlation + individual
     * cancel are confirmed by Wompi (see WOMPI_INTEGRATION.md).
     */
    checkoutEnabledByDefault: false,
  },
  plus: {
    productCode: "plus",
    displayName: "Plus",
    billingType: "subscription" as const,
    priceUsd: 8.99,
    currency: "USD" as const,
    credits: 50,
    planCode: "plus",
    periodDays: 30,
    /**
     * Same HARD BLOCK as Practice — do not enable without docs confirmation.
     */
    checkoutEnabledByDefault: false,
  },
} as const;

export type BillingProductCode = keyof typeof BILLING_PRODUCTS;

export function isBillingProductCode(value: unknown): value is BillingProductCode {
  return typeof value === "string" && value in BILLING_PRODUCTS;
}

export function resolveProduct(code: BillingProductCode) {
  return BILLING_PRODUCTS[code];
}
