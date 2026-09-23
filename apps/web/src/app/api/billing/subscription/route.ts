import { NextResponse } from "next/server";

import { createSubscriptionCheckout } from "@/lib/billing/subscriptionCheckout";
import {
  assertSubscriptionProduct,
  subscriptionLifecycleHardBlock,
} from "@/lib/billing/subscriptions";
import { bearerToken, requireUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/subscription
 * Body: { product_code: "practice" | "plus" }
 *
 * Server owns price/credits. Creates pending row + dedicated EnlacePagoRecurrente
 * when BILLING_SUBSCRIPTIONS_ENABLED=true. Cancel remains unsupported.
 */
export async function POST(request: Request) {
  const user = await requireUser(request);
  const token = bearerToken(request);
  if (!user || !token) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  let body: { product_code?: string };
  try {
    body = (await request.json()) as { product_code?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const productCheck = assertSubscriptionProduct(body.product_code ?? "");
  if (!productCheck.ok) {
    return NextResponse.json(
      { ok: false, error: productCheck.error, code: productCheck.code },
      { status: productCheck.status }
    );
  }

  const created = await createSubscriptionCheckout({
    userId: user.id,
    productCode: productCheck.productCode,
  });

  if (!created.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: created.error,
        code: created.code,
        product_code: productCheck.productCode,
        cancel_supported: false,
        credit_grant_supported: created.code !== "subscriptions_disabled",
      },
      { status: created.status }
    );
  }

  return NextResponse.json({
    ok: true,
    subscription_id: created.subscriptionId,
    product_code: created.productCode,
    url_enlace: created.urlEnlace,
    cancel_supported: false,
    credit_grant_supported: true,
  });
}

/**
 * DELETE /api/billing/subscription — individual cancel.
 * Always HARD BLOCK: Wompi has no individual cancel API (support confirmed).
 * Never accepts client-supplied external_link_id.
 */
export async function DELETE(request: Request) {
  const user = await requireUser(request);
  const token = bearerToken(request);
  if (!user || !token) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  // Ignore any body link ids — server would load ownership from DB if cancel existed.
  const block = subscriptionLifecycleHardBlock("cancel_unsupported");
  return NextResponse.json(
    {
      ok: false,
      error: block.error,
      code: block.code,
      gaps: block.gaps,
      cancel_supported: false,
    },
    { status: block.status }
  );
}
