import { NextResponse } from "next/server";

import { BILLING_PRODUCTS } from "@/lib/billing/catalog";
import { billingEnabled, billingSubscriptionsEnabled } from "@/lib/billing/wompi";
import { bearerToken, requireUser, userClient } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/** GET /api/billing/status — own purchases/subscriptions only (RLS). */
export async function GET(request: Request) {
  const user = await requireUser(request);
  const token = bearerToken(request);
  if (!user || !token) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const sb = userClient(token);
  const [{ data: purchases }, { data: subscriptions }, { data: usage }] = await Promise.all([
    sb
      .from("billing_purchases")
      .select("id, product_code, amount_usd, credits, status, settled_at, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
    sb
      .from("billing_subscriptions")
      .select("id, product_code, status, current_period_ends_at, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
    sb.rpc("get_my_usage"),
  ]);

  return NextResponse.json({
    ok: true,
    billing_enabled: billingEnabled(),
    subscriptions_enabled: billingSubscriptionsEnabled(),
    catalog: Object.values(BILLING_PRODUCTS).map((p) => ({
      product_code: p.productCode,
      display_name: p.displayName,
      billing_type: p.billingType,
      price_usd: p.priceUsd,
      credits: p.credits,
      checkout_available:
        p.billingType === "one_time"
          ? billingEnabled()
          : billingSubscriptionsEnabled(),
    })),
    usage,
    purchases: purchases ?? [],
    subscriptions: subscriptions ?? [],
  });
}
