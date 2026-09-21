/**
 * Practice/Plus subscription domain helpers.
 *
 * HARD BLOCK: Wompi docs + OpenAPI confirm shared EnlacePagoRecurrente and
 * GET .../suscripciones listing, but do NOT confirm:
 * - webhook fields that correlate a payment to an individual subscription id
 * - individual cancel API
 * - failed-renewal notification shape
 *
 * Until those are confirmed, affiliation/credit activation must stay disabled.
 * See docs/WOMPI_INTEGRATION.md § WOMPI SUBSCRIPTIONS.
 */

import {
  isBillingProductCode,
  resolveProduct,
  type BillingProductCode,
} from "./catalog";
import { billingSubscriptionsEnabled } from "./wompi";

export type SubscriptionProductCode = "practice" | "plus";

export function isSubscriptionProductCode(
  value: unknown
): value is SubscriptionProductCode {
  return value === "practice" || value === "plus";
}

/** Stable period key for idempotent grants (provider + sub + period). */
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

/**
 * Expected credits for a confirmed period payment — server catalog only.
 * Never trust client-supplied credit amounts.
 */
export function expectedPeriodCredits(productCode: BillingProductCode): number | null {
  if (!isSubscriptionProductCode(productCode)) return null;
  return resolveProduct(productCode).credits;
}

export function expectedPeriodPriceUsd(productCode: BillingProductCode): number | null {
  if (!isSubscriptionProductCode(productCode)) return null;
  return resolveProduct(productCode).priceUsd;
}

/**
 * Wompi EstadoSuscripcion is an undocumented int enum (0–4) in OpenAPI.
 * Store raw; do not invent display names.
 */
export function mapWompiEstadoSuscripcion(raw: number | undefined): {
  raw: number | null;
  known: false;
} {
  if (raw === undefined || Number.isNaN(Number(raw))) {
    return { raw: null, known: false };
  }
  return { raw: Number(raw), known: false };
}

export type SubscriptionLifecycleBlock = {
  ok: false;
  status: number;
  code: string;
  error: string;
  gaps: string[];
};

/** Shared HARD BLOCK payload for affiliation / cancel / grant activation. */
export function subscriptionLifecycleHardBlock(
  reason: "disabled" | "docs_gap" | "cancel_unsupported" = "docs_gap"
): SubscriptionLifecycleBlock {
  const gaps = [
    "Webhook payload fields that identify EnlacePagoRecurrente subscription id / idSuscriptor on each charge",
    "Whether renewal charges use the same webhook schema as one-time EnlacePago (IdentificadorEnlaceComercio)",
    "Failed recurrent payment / retry notification (API or webhook)",
    "Individual subscriber cancel endpoint (POST disable is whole EnlacePagoRecurrente only)",
    "Meaning of EstadoSuscripcion enum values 0–4",
    "Official sandbox way to simulate a renewal without waiting for diaDePago",
  ];

  if (reason === "cancel_unsupported") {
    return {
      ok: false,
      status: 501,
      code: "individual_cancel_unsupported",
      error:
        "Wompi documents only deactivating the shared EnlacePagoRecurrente, not an individual subscriber. Cancel UI stays disabled to avoid charging after a local-only cancel.",
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

  return {
    ok: false,
    status: 501,
    code: "subscriptions_partially_ready",
    error:
      "Practice/Plus are partially ready: shared EnlacePagoRecurrente APIs exist, but payment↔subscriber correlation and individual cancel are not documented safely enough to grant credits or charge users.",
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
