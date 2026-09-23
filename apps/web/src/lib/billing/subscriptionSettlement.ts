/**
 * Shared subscription payment settlement (webhook + future verified recovery).
 *
 * Wompi charges; Pianissimo verifies, correlates IdSuscripcion, and grants
 * once via grant_subscription_period_credits (DB unique barriers).
 */

import { amountsMatch, type WompiTransaction } from "./wompi";
import {
  expectedPeriodCredits,
  expectedPeriodPriceUsd,
  isSubscriptionProductCode,
} from "./subscriptions";
import { mapWompiEstadoSuscripcion } from "./wompiSubscriptionStatus";
import {
  buildSubscriptionPeriodKey,
  extractEnlacePagoId,
  type SubscriptionWebhookHints,
} from "./subscriptionPeriod";
import { serviceClient } from "@/lib/server/auth";

export type { SubscriptionWebhookHints } from "./subscriptionPeriod";
export {
  SUBSCRIPTION_PERIOD_TIMEZONE,
  buildMonthlyBillingPeriodKey,
  buildSubscriptionPeriodKey,
  extractEnlacePagoId,
  extractIdSuscripcion,
  periodDayInElSalvador,
} from "./subscriptionPeriod";

export type ProcessVerifiedSubscriptionPaymentResult =
  | {
      ok: true;
      code: string;
      subscriptionId: string;
      creditsGranted?: number;
      periodKey?: string;
    }
  | { ok: false; code: string; http?: number };

/**
 * After HMAC + S2S approval gates, settle one subscription payment idempotently.
 */
export async function processVerifiedSubscriptionPayment(opts: {
  idSuscripcion: string;
  idTransaccion: string;
  verifiedTx: WompiTransaction;
  payload: SubscriptionWebhookHints;
  eventId?: number;
  /** When true, allow binding IdSuscripcion onto a pending dedicated-link row. */
  allowPendingBind?: boolean;
}): Promise<ProcessVerifiedSubscriptionPaymentResult> {
  const sb = serviceClient();
  const idSuscripcion = opts.idSuscripcion.trim();
  const idTransaccion = opts.idTransaccion.trim();
  if (!idSuscripcion || !idTransaccion) {
    return { ok: false, code: "missing_subscription_or_tx", http: 400 };
  }

  let { data: sub } = await sb
    .from("billing_subscriptions")
    .select("*")
    .eq("provider", "wompi")
    .eq("external_subscription_id", idSuscripcion)
    .maybeSingle();

  if (!sub && opts.allowPendingBind !== false) {
    const enlaceId = extractEnlacePagoId(opts.payload);
    if (enlaceId) {
      const { data: pending } = await sb
        .from("billing_subscriptions")
        .select("*")
        .eq("provider", "wompi")
        .eq("external_enlace_id", enlaceId)
        .in("status", ["pending", "active", "suspended", "past_due"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (pending) {
        const { error: bindErr } = await sb
          .from("billing_subscriptions")
          .update({
            external_subscription_id: idSuscripcion,
            updated_at: new Date().toISOString(),
          })
          .eq("id", pending.id)
          .is("external_subscription_id", null);
        if (!bindErr) {
          sub = { ...pending, external_subscription_id: idSuscripcion };
        } else {
          const { data: again } = await sb
            .from("billing_subscriptions")
            .select("*")
            .eq("provider", "wompi")
            .eq("external_subscription_id", idSuscripcion)
            .maybeSingle();
          sub = again;
        }
      }
    }
  }

  if (!sub) {
    return { ok: false, code: "unknown_IdSuscripcion", http: 400 };
  }

  const productCode = sub.product_code as string;
  if (!isSubscriptionProductCode(productCode)) {
    return { ok: false, code: "not_subscription_product", http: 400 };
  }

  const expectedAmount = expectedPeriodPriceUsd(productCode);
  const expectedCredits = expectedPeriodCredits(productCode);
  if (expectedAmount == null || expectedCredits == null) {
    return { ok: false, code: "invalid_product", http: 400 };
  }

  const txAmount = opts.verifiedTx.monto ?? opts.verifiedTx.montoOriginal;
  if (!amountsMatch(expectedAmount, txAmount)) {
    if (!amountsMatch(expectedAmount, opts.payload.Monto)) {
      return { ok: false, code: "amount_mismatch", http: 400 };
    }
  }

  const periodKey = buildSubscriptionPeriodKey({
    externalTransactionId: idTransaccion,
    transactionTimestamp: opts.payload.FechaTransaccion,
    diaPago:
      sub.wompi_dia_pago == null || Number.isNaN(Number(sub.wompi_dia_pago))
        ? null
        : Number(sub.wompi_dia_pago),
  });

  const { data: grantResult, error: grantErr } = await sb.rpc(
    "grant_subscription_period_credits",
    {
      p_subscription_id: sub.id,
      p_period_key: periodKey,
      p_external_transaction_id: idTransaccion,
      p_event_id: opts.eventId ?? null,
    }
  );

  if (grantErr) {
    return { ok: false, code: "grant_failed", http: 500 };
  }

  const result = grantResult as {
    ok?: boolean;
    code?: string;
    credits_granted?: number;
    period_key?: string;
  };

  if (!result?.ok) {
    return { ok: false, code: result?.code ?? "grant_rejected", http: 400 };
  }

  const estadoHint = opts.payload.EstadoSuscripcion;
  const mapped = mapWompiEstadoSuscripcion(estadoHint);
  const nextStatus =
    mapped.internalStatus && mapped.internalStatus !== "undefined"
      ? mapped.internalStatus
      : "active";

  const now = new Date().toISOString();
  await sb
    .from("billing_subscriptions")
    .update({
      status: nextStatus,
      wompi_estado_raw: mapped.raw,
      last_payment_transaction_id: idTransaccion,
      pending_unverified_payment_count: 0,
      updated_at: now,
      metadata: {
        ...(typeof sub.metadata === "object" && sub.metadata ? sub.metadata : {}),
        last_settlement: {
          at: now,
          period_key: periodKey,
          code: result.code,
          event: "subscription.period_granted",
        },
      },
    })
    .eq("id", sub.id);

  try {
    await sb.from("billing_subscription_sync_events").insert({
      provider: "wompi",
      subscription_id: sub.id,
      external_subscription_id: idSuscripcion,
      external_subscriber_id: sub.external_subscriber_id ?? null,
      observation_key: `wompi:tx:${idTransaccion}:granted`,
      event_type: "subscription.period_granted",
      payload: {
        period_key: periodKey,
        credits: result.credits_granted ?? expectedCredits,
        code: result.code,
      },
      credit_grant_allowed: true,
    });
  } catch {
    /* unique observation key or audit best-effort */
  }

  return {
    ok: true,
    code: result.code ?? "granted",
    subscriptionId: sub.id as string,
    creditsGranted: result.credits_granted,
    periodKey,
  };
}
