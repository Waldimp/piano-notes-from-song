import { NextResponse } from "next/server";

import { processWompiWebhook } from "@/lib/billing/checkout";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/wompi/webhook
 * Fail-closed: HMAC over raw body (header wompi_hash) then S2S TransaccionCompra.
 * Never grants credits from browser redirect alone.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const headerHash = request.headers.get("wompi_hash");
  const result = await processWompiWebhook({ rawBody, headerHash });
  return NextResponse.json(result.body, { status: result.status });
}
