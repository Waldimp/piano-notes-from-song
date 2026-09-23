import { randomUUID } from "node:crypto";

import {
  isBillingProductCode,
  resolveProduct,
  type BillingProductCode,
} from "@/lib/billing/catalog";
import {
  amountsMatch,
  billingEnabled,
  billingSubscriptionsEnabled,
  createEnlacePago,
  getTransaccionCompra,
  loadWompiConfig,
  verifyWompiWebhookHash,
  wompiConfigured,
} from "@/lib/billing/wompi";
import {
  aplicativoMatches,
  environmentMatches,
  isApprovedTransaction,
} from "@/lib/billing/validate";
import {
  extractIdSuscripcion,
  processVerifiedSubscriptionPayment,
  type SubscriptionWebhookHints,
} from "@/lib/billing/subscriptionSettlement";
import { serviceClient } from "@/lib/server/auth";

export type WompiWebhookPayload = SubscriptionWebhookHints & {
  IdCuenta?: string;
  ResultadoTransaccion?: string;
  CodigoAutorizacion?: string;
  Aplicativo?: { Id?: string; Nombre?: string };
  /** Optional support field; not required for settlement. */
  EstadoSuscripcion?: number;
};

export async function createCheckoutForUser(opts: {
  userId: string;
  productCode: string;
}): Promise<
  | { ok: true; purchaseId: string; urlEnlace: string; productCode: BillingProductCode }
  | { ok: false; status: number; error: string; code?: string }
> {
  if (!isBillingProductCode(opts.productCode)) {
    return { ok: false, status: 400, error: "invalid product_code", code: "invalid_product" };
  }
  const product = resolveProduct(opts.productCode);

  if (!billingEnabled()) {
    return {
      ok: false,
      status: 503,
      error: "Payments setup in progress",
      code: "billing_disabled",
    };
  }

  if (product.billingType === "subscription" && !billingSubscriptionsEnabled()) {
    return {
      ok: false,
      status: 503,
      error: "Subscriptions setup in progress",
      code: "subscriptions_disabled",
    };
  }

  if (product.billingType !== "one_time") {
    return {
      ok: false,
      status: 501,
      error: "Use /api/billing/subscription for Practice/Plus",
      code: "subscription_use_dedicated_endpoint",
    };
  }

  let cfg;
  try {
    cfg = loadWompiConfig();
  } catch {
    return { ok: false, status: 503, error: "Payments setup in progress", code: "billing_disabled" };
  }

  if (!cfg.appPublicUrl) {
    return {
      ok: false,
      status: 503,
      error: "APP public URL not configured",
      code: "missing_app_url",
    };
  }

  const commerceLinkId = `pp_${opts.userId.slice(0, 8)}_${randomUUID().replace(/-/g, "")}`;
  const sb = serviceClient();

  const { data: purchase, error: insertErr } = await sb
    .from("billing_purchases")
    .insert({
      user_id: opts.userId,
      product_code: product.productCode,
      amount_usd: product.priceUsd,
      currency: product.currency,
      credits: product.credits,
      status: "pending",
      provider: "wompi",
      commerce_link_id: commerceLinkId,
      metadata: { product_code: product.productCode },
    })
    .select("id")
    .single();

  if (insertErr || !purchase) {
    return {
      ok: false,
      status: 500,
      error: insertErr?.message ?? "failed to create purchase",
      code: "purchase_insert_failed",
    };
  }

  try {
    const enlace = await createEnlacePago(cfg, {
      identificadorEnlaceComercio: commerceLinkId,
      monto: product.priceUsd,
      nombreProducto: product.displayName,
      descripcionProducto: `${product.displayName} — ${product.credits} credits`,
      urlRedirect: `${cfg.appPublicUrl}/billing/return`,
      urlRetorno: `${cfg.appPublicUrl}/pricing`,
      urlWebhook: `${cfg.appPublicUrl}/api/billing/wompi/webhook`,
    });

    await sb
      .from("billing_purchases")
      .update({
        external_enlace_id: String(enlace.idEnlace),
        url_enlace: enlace.urlEnlace,
        esta_productivo: enlace.estaProductivo,
        updated_at: new Date().toISOString(),
      })
      .eq("id", purchase.id);

    return {
      ok: true,
      purchaseId: purchase.id as string,
      urlEnlace: enlace.urlEnlace,
      productCode: product.productCode,
    };
  } catch (e) {
    await sb
      .from("billing_purchases")
      .update({
        status: "failed",
        metadata: { error: e instanceof Error ? e.message : "enlace_failed" },
        updated_at: new Date().toISOString(),
      })
      .eq("id", purchase.id);
    return {
      ok: false,
      status: 502,
      error: "Failed to create Wompi payment link",
      code: "wompi_enlace_failed",
    };
  }
}

function classifyWebhook(payload: WompiWebhookPayload): "one_time" | "subscription" | "unknown" {
  if (extractIdSuscripcion(payload)) return "subscription";
  const modulo = payload.ModuloUtilizado ?? "";
  if (/recurrent|suscrip/i.test(modulo)) return "subscription";
  if (payload.EnlacePago?.IdentificadorEnlaceComercio?.trim()) return "one_time";
  return "unknown";
}

export async function processWompiWebhook(opts: {
  rawBody: string;
  headerHash: string | null;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!wompiConfigured()) {
    return { status: 503, body: { ok: false, code: "billing_disabled" } };
  }

  const cfg = loadWompiConfig();
  const signatureValid = verifyWompiWebhookHash(opts.rawBody, opts.headerHash, cfg.clientSecret);
  if (!signatureValid) {
    return { status: 401, body: { ok: false, code: "invalid_signature" } };
  }

  let payload: WompiWebhookPayload;
  try {
    payload = JSON.parse(opts.rawBody) as WompiWebhookPayload;
  } catch {
    return { status: 400, body: { ok: false, code: "invalid_json" } };
  }

  const idTransaccion = payload.IdTransaccion?.trim();
  if (!idTransaccion) {
    return { status: 400, body: { ok: false, code: "missing_transaction_id" } };
  }

  const kind = classifyWebhook(payload);

  const sb = serviceClient();
  const externalEventKey = idTransaccion;

  const { data: existing } = await sb
    .from("billing_events")
    .select("id, processing_status")
    .eq("provider", "wompi")
    .eq("external_event_key", externalEventKey)
    .maybeSingle();

  if (existing?.processing_status === "processed") {
    return { status: 200, body: { ok: true, code: "already_processed" } };
  }

  let eventId = existing?.id as number | undefined;
  if (!eventId) {
    const { data: inserted, error: evErr } = await sb
      .from("billing_events")
      .insert({
        provider: "wompi",
        external_event_key: externalEventKey,
        external_transaction_id: idTransaccion,
        event_type: kind === "subscription" ? "webhook_subscription" : "webhook",
        payload,
        signature_valid: true,
        processing_status: "received",
      })
      .select("id")
      .single();
    if (evErr) {
      if (evErr.code === "23505") {
        return { status: 200, body: { ok: true, code: "already_received" } };
      }
      return { status: 500, body: { ok: false, code: "event_insert_failed" } };
    }
    eventId = inserted.id as number;
  }

  const reject = async (reason: string, http = 400) => {
    await sb
      .from("billing_events")
      .update({ processing_status: "rejected", rejection_reason: reason })
      .eq("id", eventId!);
    return { status: http, body: { ok: false, code: reason } };
  };

  if (
    !environmentMatches({
      webhookEsProductiva: payload.EsProductiva,
      txEsReal: undefined,
      expectProductive: cfg.expectProductive,
    }).ok
  ) {
    return reject("wrong_environment");
  }

  if (!aplicativoMatches(payload.Aplicativo?.Id, cfg.aplicativoId)) {
    return reject("wrong_aplicativo");
  }

  // ---------- Subscription path (IdSuscripcion) ----------
  if (kind === "subscription") {
    if (!billingSubscriptionsEnabled()) {
      // Accept signature + record event, but do not grant while flag off.
      return reject("subscriptions_disabled", 503);
    }

    const idSuscripcion = extractIdSuscripcion(payload);
    if (!idSuscripcion) {
      return reject("missing_IdSuscripcion");
    }

    let tx;
    try {
      tx = await getTransaccionCompra(cfg, idTransaccion);
    } catch {
      return reject("transaction_lookup_failed", 502);
    }

    if (!isApprovedTransaction(tx)) {
      return reject("transaction_not_approved");
    }

    if (
      !environmentMatches({
        webhookEsProductiva: payload.EsProductiva,
        txEsReal: tx.esReal,
        expectProductive: cfg.expectProductive,
      }).ok
    ) {
      return reject("wrong_environment_tx");
    }

    const settled = await processVerifiedSubscriptionPayment({
      idSuscripcion,
      idTransaccion,
      verifiedTx: tx,
      payload,
      eventId,
      allowPendingBind: true,
    });

    if (!settled.ok) {
      return reject(settled.code, settled.http ?? 400);
    }

    await sb
      .from("billing_events")
      .update({ processing_status: "processed" })
      .eq("id", eventId!);

    return {
      status: 200,
      body: {
        ok: true,
        code: settled.code,
        subscription_id: settled.subscriptionId,
        period_key: settled.periodKey,
        credits_granted: settled.creditsGranted,
      },
    };
  }

  // ---------- Mini Pack one-time path ----------
  const commerceLink = payload.EnlacePago?.IdentificadorEnlaceComercio?.trim();
  if (!commerceLink) {
    return reject("missing_commerce_link");
  }

  const { data: purchase } = await sb
    .from("billing_purchases")
    .select("*")
    .eq("commerce_link_id", commerceLink)
    .eq("provider", "wompi")
    .maybeSingle();

  if (!purchase) {
    return reject("unknown_purchase");
  }

  if (purchase.settled_at) {
    await sb
      .from("billing_events")
      .update({
        processing_status: "processed",
        purchase_id: purchase.id,
      })
      .eq("id", eventId!);
    return { status: 200, body: { ok: true, code: "already_settled" } };
  }

  let tx;
  try {
    tx = await getTransaccionCompra(cfg, idTransaccion);
  } catch {
    return reject("transaction_lookup_failed", 502);
  }

  if (!isApprovedTransaction(tx)) {
    await sb
      .from("billing_purchases")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", purchase.id);
    return reject("transaction_not_approved");
  }

  if (
    !environmentMatches({
      webhookEsProductiva: payload.EsProductiva,
      txEsReal: tx.esReal,
      expectProductive: cfg.expectProductive,
    }).ok
  ) {
    return reject("wrong_environment_tx");
  }

  const txAmount = tx.monto ?? tx.montoOriginal;
  if (!amountsMatch(Number(purchase.amount_usd), txAmount)) {
    return reject("amount_mismatch");
  }

  const { data: settleResult, error: settleErr } = await sb.rpc("settle_billing_purchase", {
    p_purchase_id: purchase.id,
    p_external_transaction_id: idTransaccion,
    p_event_id: eventId,
  });

  if (settleErr) {
    return reject("settle_failed", 500);
  }

  const result = settleResult as { ok?: boolean; code?: string };
  if (!result?.ok) {
    return reject(result?.code ?? "settle_rejected");
  }

  return {
    status: 200,
    body: { ok: true, code: result.code ?? "settled", purchase_id: purchase.id },
  };
}
