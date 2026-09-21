import { NextResponse } from "next/server";

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
 * Auth required. Server owns price/credits.
 * HARD BLOCK: returns subscriptions_partially_ready / subscriptions_disabled
 * until Wompi documents payment↔subscriber correlation + individual cancel.
 * Does NOT create productive charges or grant credits.
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

  const block = subscriptionLifecycleHardBlock("docs_gap");
  return NextResponse.json(
    {
      ok: false,
      error: block.error,
      code: block.code,
      product_code: productCheck.productCode,
      gaps: block.gaps,
      cancel_supported: false,
      credit_grant_supported: false,
    },
    { status: block.status }
  );
}

/**
 * DELETE /api/billing/subscription — individual cancel.
 * Always HARD BLOCK: Wompi only documents disabling the shared link.
 */
export async function DELETE(request: Request) {
  const user = await requireUser(request);
  const token = bearerToken(request);
  if (!user || !token) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

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
