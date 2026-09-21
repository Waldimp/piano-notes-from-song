import { NextResponse } from "next/server";

import { createCheckoutForUser } from "@/lib/billing/checkout";
import { bearerToken, requireUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/checkout
 * Body: { product_code: "mini_pack" | "practice" | "plus" }
 * Server resolves price/credits. Never trust client amounts.
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

  const result = await createCheckoutForUser({
    userId: user.id,
    productCode: body.product_code ?? "",
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, code: result.code },
      { status: result.status }
    );
  }

  return NextResponse.json({
    ok: true,
    purchase_id: result.purchaseId,
    product_code: result.productCode,
    url_enlace: result.urlEnlace,
  });
}
