/**
 * Practice/Plus subscription domain helpers.
 *
 * Confirmed (OpenAPI + Términos Usuario):
 * - Shared EnlacePagoRecurrente + GET .../suscripciones (id, idSuscriptor,
 *   pagosRealizados, fechaInicio, diaPago, estado raw 0–4, …)
 * - Auto-renew; failed charge retries every 4h on billing day + next day
 *
 * Still HARD BLOCK for credit grants / affiliation activation:
 * - webhook ↔ idSuscriptor correlation
 * - individual cancel API (user terms: cancel via merchant / Wompi user tools)
 * - EstadoSuscripcion label map 0–4
 * - sandbox renewal simulation
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
 * OpenAPI filter default description mentions "Activa" but does not map numbers.
 * Store raw; do not invent display names.
 */
export function mapWompiEstadoSuscripcion(raw: number | undefined): {
  raw: number | null;
  known: false;
  openApiMentionsActivaDefault: true;
} {
  if (raw === undefined || Number.isNaN(Number(raw))) {
    return { raw: null, known: false, openApiMentionsActivaDefault: true };
  }
  return { raw: Number(raw), known: false, openApiMentionsActivaDefault: true };
}

export type SubscriptionLifecycleBlock = {
  ok: false;
  status: number;
  code: string;
  error: string;
  gaps: string[];
};

/** Remaining gaps that still block safe credit grants / cancel. */
export const SUBSCRIPTION_REMAINING_GAPS = [
  "Meaning of EstadoSuscripcion enum values 0–4 (OpenAPI only says default filter is Activa)",
  "Individual subscriber cancel via merchant API (User Terms: cancel with merchant or Wompi user tools; API only disables whole EnlacePagoRecurrente)",
  "Webhook payload fields that correlate a recurrent charge to idSuscriptor / subscription id",
  "Official sandbox way to simulate a renewal without waiting for diaDePago",
] as const;

/** Shared HARD BLOCK payload for affiliation / cancel / grant activation. */
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
        "No merchant API for individual cancel is documented. User Terms say cancel via merchant agreement or Wompi user tools; POST /EnlacePagoRecurrente/{id} disables the shared link for everyone.",
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
      "Practice/Plus sync/reconcile is ready, but credit grants stay blocked until webhook↔subscriber correlation is documented. pagosRealizados increments alone never grant credits.",
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
