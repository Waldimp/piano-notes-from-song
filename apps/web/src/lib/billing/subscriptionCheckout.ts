/**
 * Create Practice/Plus checkout: pending internal subscription + dedicated
 * EnlacePagoRecurrente (one link intended per subscription).
 *
 * Gated by BILLING_SUBSCRIPTIONS_ENABLED. Does not cancel / disable links.
 * Cancel remains unsupported until dedicated-link safety is proven in canary.
 */

import { randomUUID } from "node:crypto";

import { resolveProduct } from "./catalog";
import {
  assertSubscriptionProduct,
  subscriptionAffiliationAllowed,
  type SubscriptionProductCode,
} from "./subscriptions";
import {
  billingEnabled,
  createEnlacePagoRecurrente,
  loadWompiConfig,
  wompiConfigured,
} from "./wompi";
import { serviceClient } from "@/lib/server/auth";

function diaDePagoElSalvador(): number {
  // Fixed UTC−6
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60_000;
  const sv = new Date(utc - 6 * 60 * 60_000);
  return sv.getUTCDate();
}

export async function createSubscriptionCheckout(opts: {
  userId: string;
  productCode: string;
}): Promise<
  | {
      ok: true;
      subscriptionId: string;
      urlEnlace: string;
      productCode: SubscriptionProductCode;
    }
  | { ok: false; status: number; error: string; code: string; gaps?: string[] }
> {
  const productCheck = assertSubscriptionProduct(opts.productCode);
  if (!productCheck.ok) {
    return {
      ok: false,
      status: productCheck.status,
      error: productCheck.error,
      code: productCheck.code,
    };
  }

  if (!billingEnabled() || !wompiConfigured()) {
    return {
      ok: false,
      status: 503,
      error: "Payments setup in progress",
      code: "billing_disabled",
    };
  }

  if (!subscriptionAffiliationAllowed()) {
    return {
      ok: false,
      status: 503,
      error: "Subscriptions setup in progress",
      code: "subscriptions_disabled",
    };
  }

  const product = resolveProduct(productCheck.productCode);
  let cfg;
  try {
    cfg = loadWompiConfig();
  } catch {
    return {
      ok: false,
      status: 503,
      error: "Payments setup in progress",
      code: "billing_disabled",
    };
  }

  const sb = serviceClient();
  const commerceLinkId = `sub_${opts.userId.slice(0, 8)}_${randomUUID().replace(/-/g, "")}`;

  // One open affiliation per user+product
  const { data: existingOpen } = await sb
    .from("billing_subscriptions")
    .select("id, status")
    .eq("user_id", opts.userId)
    .eq("product_code", product.productCode)
    .in("status", ["pending", "active", "suspended", "past_due"])
    .maybeSingle();

  if (existingOpen?.status === "active" || existingOpen?.status === "suspended") {
    return {
      ok: false,
      status: 409,
      error: "Already subscribed to this plan",
      code: "already_subscribed",
    };
  }

  const { data: sub, error: insertErr } = await sb
    .from("billing_subscriptions")
    .insert({
      user_id: opts.userId,
      product_code: product.productCode,
      status: "pending",
      provider: "wompi",
      commerce_link_id: commerceLinkId,
      dedicated_enlace: true,
      metadata: {
        event: "subscription.created",
        product_code: product.productCode,
      },
    })
    .select("id")
    .single();

  // If unique index conflict on pending row, return conflict
  if (insertErr || !sub) {
    if (insertErr?.code === "23505" || existingOpen) {
      return {
        ok: false,
        status: 409,
        error: "Subscription already in progress",
        code: "subscription_pending",
      };
    }
    return {
      ok: false,
      status: 500,
      error: insertErr?.message ?? "failed to create subscription",
      code: "subscription_insert_failed",
    };
  }

  try {
    const enlace = await createEnlacePagoRecurrente(cfg, {
      diaDePago: diaDePagoElSalvador(),
      nombre: `${product.displayName} — ${commerceLinkId.slice(0, 24)}`,
      idAplicativo: cfg.aplicativoId,
      monto: product.priceUsd,
      descripcionProducto: `${product.displayName}: ${product.credits} credits / month`,
    });

    const now = new Date().toISOString();
    await sb
      .from("billing_subscriptions")
      .update({
        external_enlace_id: String(enlace.idEnlace),
        metadata: {
          event: "subscription.created",
          product_code: product.productCode,
          url_enlace: enlace.urlEnlace,
          esta_productivo: enlace.estaProductivo,
          dedicated_enlace: true,
        },
        updated_at: now,
      })
      .eq("id", sub.id);

    await sb.from("billing_subscription_sync_events").insert({
      provider: "wompi",
      subscription_id: sub.id,
      observation_key: `wompi:sub:${sub.id}:created`,
      event_type: "subscription.created",
      payload: { product_code: product.productCode, external_enlace_id: enlace.idEnlace },
      credit_grant_allowed: false,
    });

    return {
      ok: true,
      subscriptionId: sub.id as string,
      urlEnlace: enlace.urlEnlace,
      productCode: productCheck.productCode,
    };
  } catch (e) {
    await sb
      .from("billing_subscriptions")
      .update({
        status: "cancelled",
        metadata: {
          error: e instanceof Error ? e.message : "enlace_recurrente_failed",
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", sub.id);
    return {
      ok: false,
      status: 502,
      error: "Failed to create Wompi recurring link",
      code: "wompi_enlace_recurrente_failed",
    };
  }
}
