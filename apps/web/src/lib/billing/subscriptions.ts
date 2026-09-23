/**
 * Practice/Plus subscription domain helpers.
 *
 * Confirmed (Wompi technical support + OpenAPI + User Terms):
 * - EstadoSuscripcion 0–4 mapped (see wompiSubscriptionStatus.ts)
 * - Webhook recurrent charges include IdSuscripcion
 * - Auto-renew + retries by Wompi (we do not charge)
 * - NO individual cancel API — only disable whole EnlacePagoRecurrente
 * - NO sandbox renewal simulation (real merchant required)
 *
 * Cancel stays HARD BLOCKED until one-link-per-subscription is proven safe
 * in a real productive canary (see WOMPI_INTEGRATION.md).
 */

import {
  isBillingProductCode,
  resolveProduct,
  type BillingProductCode,
} from "./catalog";
import { billingSubscriptionsEnabled } from "./wompi";
import { mapWompiEstadoSuscripcion } from "./wompiSubscriptionStatus";

export type SubscriptionProductCode = "practice" | "plus";

export function isSubscriptionProductCode(
  value: unknown
): value is SubscriptionProductCode {
  return value === "practice" || value === "plus";
}

/** Stable period key for idempotent grants (day + optional tx). */
export function buildPeriodKey(opts: {
  periodStartIso: string;
  externalTransactionId?: string;
}): string {
  const day = opts.periodStartIso.slice(0, 10);
  if (opts.externalTransactionId) {
    return `${day}:${opts.externalTransactionId}`;
  }
  return day;
}

export function expectedPeriodCredits(productCode: BillingProductCode): number | null {
  if (!isSubscriptionProductCode(productCode)) return null;
  return resolveProduct(productCode).credits;
}

export function expectedPeriodPriceUsd(productCode: BillingProductCode): number | null {
  if (!isSubscriptionProductCode(productCode)) return null;
  return resolveProduct(productCode).priceUsd;
}

/** @deprecated Prefer mapWompiEstadoSuscripcion from wompiSubscriptionStatus — re-export for callers. */
export { mapWompiEstadoSuscripcion };

export type SubscriptionLifecycleBlock = {
  ok: false;
  status: number;
  code: string;
  error: string;
  gaps: string[];
};

/**
 * Remaining operational gaps after Wompi support response.
 * Credit grants + IdSuscripcion correlation are implemented; cancel is not.
 */
export const SUBSCRIPTION_REMAINING_GAPS = [
  "Individual subscriber cancel API does not exist (Wompi support): only POST /EnlacePagoRecurrente/{id} disables the entire link",
  "One-link-per-subscription cancel strategy is not yet proven safe against multi-affiliate / panel limits (see CANCELLATION PROVIDER LIMITATION)",
  "Sandbox renewal simulation does not exist; real productive merchant required for renewal E2E",
] as const;

export function subscriptionLifecycleHardBlock(
  reason: "disabled" | "docs_gap" | "cancel_unsupported" = "docs_gap"
): SubscriptionLifecycleBlock {
  const gaps = [...SUBSCRIPTION_REMAINING_GAPS];

  if (reason === "cancel_unsupported") {
    return {
      ok: false,
      status: 501,
      code: "individual_cancel_unsupported",
      error:
        "Wompi confirmed there is no API to cancel an individual subscription. Disabling EnlacePagoRecurrente affects the whole link. Manage/Cancel stays disabled until a dedicated-link design is proven safe.",
      gaps,
    };
  }

  if (reason === "disabled" || !billingSubscriptionsEnabled()) {
    return {
      ok: false,
      status: 503,
      code: "subscriptions_disabled",
      error: "Subscriptions setup in progress",
      gaps,
    };
  }

  // Flag on but cancel/docs still incomplete for full self-serve lifecycle
  return {
    ok: false,
    status: 501,
    code: "subscriptions_cancel_limited",
    error:
      "Subscription payments are architecturally ready, but individual cancel remains unsupported by Wompi.",
    gaps,
  };
}

export function assertSubscriptionProduct(productCode: string): {
  ok: true;
  productCode: SubscriptionProductCode;
} | {
  ok: false;
  status: number;
  code: string;
  error: string;
} {
  if (!isBillingProductCode(productCode) || !isSubscriptionProductCode(productCode)) {
    return {
      ok: false,
      status: 400,
      error: "invalid product_code",
      code: "invalid_product",
    };
  }
  const product = resolveProduct(productCode);
  if (product.billingType !== "subscription") {
    return {
      ok: false,
      status: 400,
      error: "invalid product_code",
      code: "invalid_product",
    };
  }
  return { ok: true, productCode };
}

/** Whether affiliation/checkout may proceed (flag on). Cancel remains separate. */
export function subscriptionAffiliationAllowed(): boolean {
  return billingSubscriptionsEnabled();
}
