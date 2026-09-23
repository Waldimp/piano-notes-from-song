import { describe, expect, it } from "vitest";

import {
  WOMPI_ESTADO_SUSCRIPCION_NOTES,
  WOMPI_RECURRENT_RETRY,
  buildPagosObservationKey,
  normalizeWompiSuscripcion,
  reconcileWompiSubscriptionSnapshot,
} from "./subscriptionReconcile";
import { mapWompiEstadoSuscripcion, SUBSCRIPTION_REMAINING_GAPS } from "./subscriptions";

describe("Wompi recurrent official facts", () => {
  it("encodes User Terms retry policy", () => {
    expect(WOMPI_RECURRENT_RETRY.intervalHours).toBe(4);
    expect(WOMPI_RECURRENT_RETRY.daysCovered).toBe(2);
  });

  it("uses official EstadoSuscripcion labels from support", () => {
    expect(WOMPI_ESTADO_SUSCRIPCION_NOTES.labelsPublished).toBe(true);
    expect(WOMPI_ESTADO_SUSCRIPCION_NOTES.labels[0]).toBe("Activa");
    expect(WOMPI_ESTADO_SUSCRIPCION_NOTES.labels[1]).toBe("Suspendida");
    expect(mapWompiEstadoSuscripcion(1).label).toBe("suspended");
    expect(mapWompiEstadoSuscripcion(0).known).toBe(true);
  });

  it("lists remaining gaps after support response (cancel + sandbox renewal)", () => {
    const blob = SUBSCRIPTION_REMAINING_GAPS.join(" ");
    expect(blob).toMatch(/cancel/i);
    expect(blob).toMatch(/sandbox|real productive|renov/i);
    expect(blob).not.toMatch(/EstadoSuscripcion enum values 0/);
    expect(blob).not.toMatch(/webhook ↔ idSuscriptor/);
    expect(blob).not.toMatch(/reintent/i);
  });
});

describe("subscription snapshot reconcile", () => {
  const remote = {
    id: "sub-1",
    idSuscriptor: "person-9",
    alias: "a",
    nombreSuscriptor: "Ada",
    monto: 5.99,
    pagosRealizados: 1,
    estado: 0,
    fechaInicio: "2026-09-01T00:00:00Z",
    diaPago: 15,
  };

  it("normalizes OpenAPI suscripcion fields", () => {
    expect(normalizeWompiSuscripcion(remote)).toMatchObject({
      id: "sub-1",
      idSuscriptor: "person-9",
      pagosRealizados: 1,
      diaPago: 15,
      estado: 0,
    });
  });

  it("detects payment count increase but never allows credit grant", () => {
    const first = reconcileWompiSubscriptionSnapshot(null, remote);
    expect(first.needsVerifiedTransaction).toBe(true);
    expect(first.persisted.pagos_realizados).toBe(1);
    expect(first.persisted.external_subscriber_id).toBe("person-9");
    expect(first.events.every((e) => e.creditGrantAllowed === false)).toBe(true);

    const second = reconcileWompiSubscriptionSnapshot(
      {
        externalSubscriptionId: "sub-1",
        externalSubscriberId: "person-9",
        pagosRealizados: 1,
        wompiEstadoRaw: 0,
        wompiFechaInicio: "2026-09-01T00:00:00Z",
        wompiDiaPago: 15,
        pendingUnverifiedPaymentCount: 1,
      },
      { ...remote, pagosRealizados: 2 }
    );
    expect(second.needsVerifiedTransaction).toBe(true);
    expect(second.persisted.pending_unverified_payment_count).toBeGreaterThanOrEqual(2);
    expect(second.events.some((e) => e.type === "reconciliation_requires_review")).toBe(true);
    expect(second.events.every((e) => e.creditGrantAllowed === false)).toBe(true);
  });

  it("idempotent observation key for pagos watermark", () => {
    expect(
      buildPagosObservationKey({
        idSuscriptor: "person-9",
        pagosRealizados: 2,
        externalSubscriptionId: "sub-1",
      })
    ).toBe("wompi:subscriber:person-9:pagos:2:sub:sub-1");
  });

  it("unchanged pagos is a no-op for grants", () => {
    const result = reconcileWompiSubscriptionSnapshot(
      {
        externalSubscriptionId: "sub-1",
        externalSubscriberId: "person-9",
        pagosRealizados: 1,
        wompiEstadoRaw: 0,
        wompiFechaInicio: "2026-09-01T00:00:00Z",
        wompiDiaPago: 15,
        pendingUnverifiedPaymentCount: 0,
      },
      remote
    );
    expect(result.needsVerifiedTransaction).toBe(false);
    expect(result.events.some((e) => e.type === "payment_count_unchanged")).toBe(true);
  });
});
