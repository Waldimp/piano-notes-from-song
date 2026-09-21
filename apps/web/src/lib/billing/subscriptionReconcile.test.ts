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

  it("does not invent EstadoSuscripcion labels", () => {
    expect(WOMPI_ESTADO_SUSCRIPCION_NOTES.labelsPublished).toBe(false);
    expect(WOMPI_ESTADO_SUSCRIPCION_NOTES.openApiDefaultFilterDescription).toBe("Activa");
    expect(mapWompiEstadoSuscripcion(1)).toEqual({
      raw: 1,
      known: false,
      openApiMentionsActivaDefault: true,
    });
  });

  it("lists only remaining real gaps", () => {
    const blob = SUBSCRIPTION_REMAINING_GAPS.join(" ");
    expect(blob).toMatch(/EstadoSuscripcion/);
    expect(blob).toMatch(/cancel/i);
    expect(blob).toMatch(/webhook|correlat/i);
    expect(blob).toMatch(/sandbox|renovation|renov/i);
    expect(blob).not.toMatch(/reintent/i);
    expect(blob).not.toMatch(/idSuscriptor is unknown/i);
    expect(blob).not.toMatch(/pagosRealizados is unknown/i);
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
    expect(second.persisted.pending_unverified_payment_count).toBe(2);
    const bump = second.events.find((e) => e.type === "payment_count_increased");
    expect(bump?.creditGrantAllowed).toBe(false);
    expect(bump?.observationKey).toBe(
      buildPagosObservationKey({
        idSuscriptor: "person-9",
        pagosRealizados: 2,
        externalSubscriptionId: "sub-1",
      })
    );
  });

  it("is idempotent on unchanged pagosRealizados", () => {
    const prev = {
      externalSubscriptionId: "sub-1",
      externalSubscriberId: "person-9",
      pagosRealizados: 2,
      wompiEstadoRaw: 0,
      wompiFechaInicio: "2026-09-01T00:00:00Z",
      wompiDiaPago: 15,
      pendingUnverifiedPaymentCount: 0,
    };
    const again = reconcileWompiSubscriptionSnapshot(prev, {
      ...remote,
      pagosRealizados: 2,
    });
    expect(again.needsVerifiedTransaction).toBe(false);
    expect(again.events.some((e) => e.type === "payment_count_unchanged")).toBe(true);
    expect(again.events.some((e) => e.type === "payment_count_increased")).toBe(false);
  });

  it("records estado changes as raw-only observations", () => {
    const r = reconcileWompiSubscriptionSnapshot(
      {
        externalSubscriptionId: "sub-1",
        externalSubscriberId: "person-9",
        pagosRealizados: 1,
        wompiEstadoRaw: 0,
        wompiFechaInicio: null,
        wompiDiaPago: 15,
        pendingUnverifiedPaymentCount: 0,
      },
      { ...remote, estado: 2 }
    );
    const ev = r.events.find((e) => e.type === "estado_changed");
    expect(ev?.detail).toMatchObject({ from: 0, to: 2 });
    expect(ev?.creditGrantAllowed).toBe(false);
  });
});
