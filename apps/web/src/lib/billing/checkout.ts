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
import { serviceClient } from "@/lib/server/auth";

export type WompiWebhookPayload = {
  IdCuenta?: string;
  IdTransaccion?: string;
  Monto?: number;
  ResultadoTransaccion?: string;
  EsProductiva?: boolean;
  CodigoAutorizacion?: string;
  ModuloUtilizado?: string;
  Aplicativo?: { Id?: string; Nombre?: string };
  EnlacePago?: {
    Id?: number;
    IdentificadorEnlaceComercio?: string;
    NombreProducto?: string;
  };
  /** Not confirmed in official webhook docs for recurrent charges — tolerate but do not settle on alone. */
  IdSuscripcion?: string;
  idSuscripcion?: string;
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
    // Recurrent checkout path reserved; do not invent per-subscriber renewal grants.
    return {
      ok: false,
      status: 501,
      error: "Subscription checkout not enabled yet",
      code: "subscription_blocked",
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
  const commerceLink = payload.EnlacePago?.IdentificadorEnlaceComercio?.trim();
  if (!idTransaccion) {
    return { status: 400, body: { ok: false, code: "missing_transaction_id" } };
  }

  // One-time Mini Pack requires IdentificadorEnlaceComercio (existing path).
  // Without it, never invent subscription settlement — docs do not confirm
  // webhook↔subscriber correlation for EnlacePagoRecurrente.
  if (!commerceLink) {
    const modulo = payload.ModuloUtilizado ?? "";
    const hasSubHint =
      Boolean(payload.IdSuscripcion || payload.idSuscripcion) ||
      /recurrent|suscrip/i.test(modulo);
    if (hasSubHint || !payload.EnlacePago) {
      return {
        status: 501,
        body: {
          ok: false,
          code: "recurrent_lifecycle_blocked",
          detail:
            "Subscription webhooks are not settled until Wompi documents subscriber correlation",
        },
      };
    }
    return { status: 400, body: { ok: false, code: "missing_commerce_link" } };
  }

  const sb = serviceClient();
  const externalEventKey = idTransaccion;

  // Idempotent insert of raw event
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
        event_type: "webhook",
        payload,
        signature_valid: true,
        processing_status: "received",
      })
      .select("id")
      .single();
    if (evErr) {
      // Unique race → treat as duplicate
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

  // Server-to-server confirmation (docs: Validar Consultando Transacción)
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
