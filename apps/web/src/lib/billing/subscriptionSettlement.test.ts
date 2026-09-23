import { describe, expect, it } from "vitest";

import {
  mapWompiEstadoSuscripcion,
  subscriptionStatusDisplayEs,
  WOMPI_ESTADO_SUSCRIPCION,
} from "./wompiSubscriptionStatus";
import {
  buildSubscriptionPeriodKey,
  extractEnlacePagoId,
  extractIdSuscripcion,
  periodDayInElSalvador,
} from "./subscriptionPeriod";
import { reconcileWompiSubscriptionSnapshot } from "./subscriptionReconcile";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");

function readWeb(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

describe("EstadoSuscripcion official map (Wompi support)", () => {
  it("maps 0–4", () => {
    expect(mapWompiEstadoSuscripcion(0)).toMatchObject({
      known: true,
      label: "active",
      internalStatus: "active",
      allowsNewGrants: true,
    });
    expect(mapWompiEstadoSuscripcion(1)).toMatchObject({
      label: "suspended",
      internalStatus: "suspended",
      allowsNewGrants: false,
    });
    expect(mapWompiEstadoSuscripcion(2)).toMatchObject({
      label: "cancelled",
      internalStatus: "cancelled",
    });
    expect(mapWompiEstadoSuscripcion(3)).toMatchObject({
      label: "finished",
      internalStatus: "finished",
    });
    expect(mapWompiEstadoSuscripcion(4)).toMatchObject({
      label: "undefined",
      internalStatus: "undefined",
      allowsNewGrants: false,
    });
  });

  it("rejects unexpected values without financial effects", () => {
    expect(mapWompiEstadoSuscripcion(99).known).toBe(false);
    expect(mapWompiEstadoSuscripcion(99).allowsNewGrants).toBe(false);
    expect(mapWompiEstadoSuscripcion(null).raw).toBeNull();
    expect(mapWompiEstadoSuscripcion(undefined).known).toBe(false);
  });

  it("centralizes constants", () => {
    expect(WOMPI_ESTADO_SUSCRIPCION[0]).toBe("active");
    expect(WOMPI_ESTADO_SUSCRIPCION[2]).toBe("cancelled");
  });

  it("Spanish display labels", () => {
    expect(subscriptionStatusDisplayEs("active")).toBe("Activa");
    expect(subscriptionStatusDisplayEs("suspended")).toBe("Suspendida");
    expect(subscriptionStatusDisplayEs("cancelled")).toBe("Cancelada");
    expect(subscriptionStatusDisplayEs("finished")).toBe("Finalizada");
  });
});

describe("IdSuscripcion extraction", () => {
  it("accepts IdSuscripcion and idSuscripcion casing", () => {
    expect(extractIdSuscripcion({ IdSuscripcion: "sub-1" })).toBe("sub-1");
    expect(extractIdSuscripcion({ idSuscripcion: "sub-2" })).toBe("sub-2");
    expect(extractIdSuscripcion({})).toBeNull();
  });

  it("extracts EnlacePago.Id for pending bind", () => {
    expect(extractEnlacePagoId({ EnlacePago: { Id: 99 } })).toBe("99");
    expect(extractEnlacePagoId({ EnlacePago: { Id: "abc" } })).toBe("abc");
  });
});

describe("period keys (monthly cycle, not transaction-scoped)", () => {
  it("does not embed transaction id", () => {
    const key = buildSubscriptionPeriodKey({
      externalTransactionId: "tx-abc",
      transactionTimestamp: "2026-09-21T18:00:00-06:00",
      diaPago: 21,
    });
    expect(key).toBe("cycle:2026-09");
    expect(key).not.toContain("tx-abc");
  });

  it("two txs in the same billing cycle share one period key", () => {
    const a = buildSubscriptionPeriodKey({
      transactionTimestamp: "2026-09-21T10:00:00-06:00",
      diaPago: 21,
      externalTransactionId: "tx-1",
    });
    const b = buildSubscriptionPeriodKey({
      transactionTimestamp: "2026-09-21T22:00:00-06:00",
      diaPago: 21,
      externalTransactionId: "tx-2",
    });
    expect(a).toBe(b);
    expect(a).toBe("cycle:2026-09");
  });

  it("retry day after diaPago stays in the same cycle", () => {
    expect(
      buildSubscriptionPeriodKey({
        transactionTimestamp: "2026-09-22T12:00:00-06:00",
        diaPago: 21,
      })
    ).toBe("cycle:2026-09");
  });

  it("diaPago=31 retry on day 1 maps to previous month cycle", () => {
    expect(
      buildSubscriptionPeriodKey({
        transactionTimestamp: "2026-10-01T12:00:00-06:00",
        diaPago: 31,
      })
    ).toBe("cycle:2026-09");
  });

  it("next calendar month with diaPago yields a new cycle", () => {
    const sep = buildSubscriptionPeriodKey({
      transactionTimestamp: "2026-09-21T12:00:00-06:00",
      diaPago: 21,
    });
    const oct = buildSubscriptionPeriodKey({
      transactionTimestamp: "2026-10-21T12:00:00-06:00",
      diaPago: 21,
    });
    expect(sep).toBe("cycle:2026-09");
    expect(oct).toBe("cycle:2026-10");
    expect(sep).not.toBe(oct);
  });

  it("without diaPago falls back to calendar YYYY-MM (never invents diaPago)", () => {
    expect(
      buildSubscriptionPeriodKey({
        transactionTimestamp: "2026-09-05T12:00:00-06:00",
        diaPago: null,
      })
    ).toBe("cycle:2026-09");
  });

  it("periodDayInElSalvador is YYYY-MM-DD", () => {
    expect(periodDayInElSalvador("2026-09-21T23:30:00.000Z")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("reconciliation never grants from pagosRealizados alone", () => {
  it("flags requires_review on delta", () => {
    const result = reconcileWompiSubscriptionSnapshot(
      {
        externalSubscriptionId: "s1",
        externalSubscriberId: "u1",
        pagosRealizados: 1,
        wompiEstadoRaw: 0,
        wompiFechaInicio: null,
        wompiDiaPago: 21,
        pendingUnverifiedPaymentCount: 0,
      },
      {
        id: "s1",
        idSuscriptor: "u1",
        pagosRealizados: 2,
        estado: 0,
        monto: 5.99,
      }
    );
    expect(result.needsVerifiedTransaction).toBe(true);
    expect(result.events.some((e) => e.type === "reconciliation_requires_review")).toBe(true);
    expect(result.events.every((e) => e.creditGrantAllowed === false)).toBe(true);
  });

  it("maps estado change with official labels", () => {
    const result = reconcileWompiSubscriptionSnapshot(
      {
        externalSubscriptionId: "s1",
        externalSubscriberId: "u1",
        pagosRealizados: 1,
        wompiEstadoRaw: 0,
        wompiFechaInicio: null,
        wompiDiaPago: 21,
        pendingUnverifiedPaymentCount: 0,
      },
      {
        id: "s1",
        idSuscriptor: "u1",
        pagosRealizados: 1,
        estado: 1,
      }
    );
    const ev = result.events.find((e) => e.type === "estado_changed");
    expect(ev?.detail.label).toBe("suspended");
  });

  it("reconciler source never calls grant RPC", () => {
    const reconcile = readWeb("src/lib/billing/runSubscriptionReconciliation.ts");
    expect(reconcile).not.toContain("grant_subscription_period_credits");
    expect(reconcile).not.toContain("processVerifiedSubscriptionPayment");
    expect(reconcile).toContain("credit_grant_allowed: false");
  });
});

describe("DB idempotency barriers in migrations", () => {
  it("0013 keeps unique period + unique transaction", () => {
    const repo = resolve(root, "../..");
    const sql = readFileSync(
      resolve(repo, "migrations/supabase/0013_wompi_subscriptions.sql"),
      "utf8"
    );
    expect(sql).toContain("unique (subscription_id, period_key)");
    expect(sql).toContain("unique (provider, external_transaction_id)");
    expect(sql).toContain("for update");
  });

  it("0016 documents cycle period_key and race-safe already_granted", () => {
    const repo = resolve(root, "../..");
    const sql = readFileSync(
      resolve(repo, "migrations/supabase/0016_subscription_period_key_contract.sql"),
      "utf8"
    );
    expect(sql).toContain("cycle:YYYY-MM");
    expect(sql).toContain("NOT embed IdTransaccion");
    expect(sql).toContain("for update");
    expect(sql).toContain("already_granted");
    expect(sql).toContain("transaction_already_used");
  });
});

describe("webhook / settlement architecture source gates", () => {
  it("webhook uses shared processVerifiedSubscriptionPayment and keeps Mini Pack settle", () => {
    const checkout = readWeb("src/lib/billing/checkout.ts");
    expect(checkout).toContain("processVerifiedSubscriptionPayment");
    expect(checkout).toContain("settle_billing_purchase");
    expect(checkout).toContain("extractIdSuscripcion");
    expect(checkout).not.toContain("recurrent_lifecycle_blocked");
  });

  it("cancel remains hard-blocked and ignores client link ids", () => {
    const route = readWeb("src/app/api/billing/subscription/route.ts");
    expect(route).toContain("cancel_unsupported");
    expect(route).toContain("cancel_supported: false");
    expect(route).toContain("createSubscriptionCheckout");
  });

  it("daily reconcile cron is wired", () => {
    const vercel = readWeb("vercel.json");
    expect(vercel).toContain("/api/billing/reconcile-subscriptions");
    const route = readWeb("src/app/api/billing/reconcile-subscriptions/route.ts");
    expect(route).toContain("CRON_SECRET");
    expect(route).toContain("runSubscriptionReconciliation");
  });

  it("settlement never trusts client price/credits", () => {
    const settle = readWeb("src/lib/billing/subscriptionSettlement.ts");
    expect(settle).toContain("expectedPeriodPriceUsd");
    expect(settle).toContain("expectedPeriodCredits");
    expect(settle).toContain("grant_subscription_period_credits");
  });
});
