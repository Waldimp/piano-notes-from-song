/**
 * Pure reconciliation of Wompi EnlacePagoRecurrente subscription snapshots.
 *
 * Official sources:
 * - OpenAPI SuscripcionEnlacePagoRecurrenteOutputDto
 * - Términos Usuario Wompi (auto-renew; retry every 4h on billing day + next day)
 *
 * NEVER grants credits from pagosRealizados alone — that count is not a
 * verified approved TransaccionCompra id.
 */

import { mapWompiEstadoSuscripcion } from "./wompiSubscriptionStatus";
import type { WompiSuscripcionRecurrente } from "./wompi";

/** Confirmed by Wompi User Terms (pagos recurrentes). */
export const WOMPI_RECURRENT_RETRY = {
  intervalHours: 4,
  /** Retries on the agreed billing day and the following day. */
  daysCovered: 2,
  source: "https://wompi.sv/TerminosCondiciones/Usuario",
} as const;

export type WompiSubscriptionSnapshot = {
  id: string | null;
  idSuscriptor: string | null;
  alias: string | null;
  nombreSuscriptor: string | null;
  monto: number | null;
  pagosRealizados: number | null;
  estado: number | null;
  fechaInicio: string | null;
  diaPago: number | null;
};

export type StoredSubscriptionSyncState = {
  externalSubscriptionId: string | null;
  externalSubscriberId: string | null;
  pagosRealizados: number | null;
  wompiEstadoRaw: number | null;
  wompiFechaInicio: string | null;
  wompiDiaPago: number | null;
  pendingUnverifiedPaymentCount: number;
};

export type SyncObservationEvent = {
  type:
    | "first_sync"
    | "snapshot_updated"
    | "payment_count_increased"
    | "payment_count_unchanged"
    | "payment_count_decreased"
    | "estado_changed"
    | "reconciliation_requires_review";
  observationKey: string;
  /** Always false until a verified approved transaction id is correlated. */
  creditGrantAllowed: false;
  detail: Record<string, unknown>;
};

export type ReconcileResult = {
  snapshot: WompiSubscriptionSnapshot;
  persisted: {
    external_subscription_id: string | null;
    external_subscriber_id: string | null;
    wompi_alias: string | null;
    wompi_nombre_suscriptor: string | null;
    wompi_monto: number | null;
    pagos_realizados: number | null;
    wompi_estado_raw: number | null;
    wompi_fecha_inicio: string | null;
    wompi_dia_pago: number | null;
    last_pagos_realizados_observed: number | null;
    pending_unverified_payment_count: number;
  };
  events: SyncObservationEvent[];
  /** True when pagosRealizados rose but credits must NOT be granted yet. */
  needsVerifiedTransaction: boolean;
};

export function normalizeWompiSuscripcion(
  raw: WompiSuscripcionRecurrente
): WompiSubscriptionSnapshot {
  return {
    id: raw.id?.trim() || null,
    idSuscriptor: raw.idSuscriptor?.trim() || null,
    alias: raw.alias?.trim() || null,
    nombreSuscriptor: raw.nombreSuscriptor?.trim() || null,
    monto: raw.monto == null || Number.isNaN(Number(raw.monto)) ? null : Number(raw.monto),
    pagosRealizados:
      raw.pagosRealizados == null || Number.isNaN(Number(raw.pagosRealizados))
        ? null
        : Number(raw.pagosRealizados),
    estado:
      raw.estado == null || Number.isNaN(Number(raw.estado)) ? null : Number(raw.estado),
    fechaInicio: raw.fechaInicio?.trim() || null,
    diaPago:
      raw.diaPago == null || Number.isNaN(Number(raw.diaPago)) ? null : Number(raw.diaPago),
  };
}

/**
 * Idempotent observation key for a subscriber payment-count watermark.
 * Safe for sync_events uniqueness; NOT a credit grant key by itself.
 */
export function buildPagosObservationKey(opts: {
  idSuscriptor: string;
  pagosRealizados: number;
  externalSubscriptionId?: string | null;
}): string {
  const sub = opts.externalSubscriptionId?.trim() || "unknown-sub";
  return `wompi:subscriber:${opts.idSuscriptor}:pagos:${opts.pagosRealizados}:sub:${sub}`;
}

/**
 * Reconcile remote Wompi snapshot into local fields + observation events.
 * Does not call ledger / grant RPCs.
 */
export function reconcileWompiSubscriptionSnapshot(
  previous: StoredSubscriptionSyncState | null,
  remote: WompiSuscripcionRecurrente
): ReconcileResult {
  const snapshot = normalizeWompiSuscripcion(remote);
  const events: SyncObservationEvent[] = [];
  let pending =
    previous?.pendingUnverifiedPaymentCount && previous.pendingUnverifiedPaymentCount > 0
      ? previous.pendingUnverifiedPaymentCount
      : 0;
  let needsVerifiedTransaction = false;

  const subscriberKey = snapshot.idSuscriptor ?? "unknown-subscriber";
  const subId = snapshot.id;

  if (!previous) {
    events.push({
      type: "first_sync",
      observationKey: `wompi:subscriber:${subscriberKey}:first_sync:${subId ?? "noid"}`,
      creditGrantAllowed: false,
      detail: { snapshot },
    });
    if (snapshot.pagosRealizados != null && snapshot.pagosRealizados > 0) {
      // Historical payments may already exist; do not grant without verified txs.
      pending = snapshot.pagosRealizados;
      needsVerifiedTransaction = true;
        events.push({
          type: "payment_count_increased",
          observationKey: buildPagosObservationKey({
            idSuscriptor: subscriberKey,
            pagosRealizados: snapshot.pagosRealizados,
            externalSubscriptionId: subId,
          }),
          creditGrantAllowed: false,
          detail: {
            from: 0,
            to: snapshot.pagosRealizados,
            reason:
              "RECONCILIATION_REQUIRES_REVIEW: pagosRealizados alone is not a verified TransaccionCompra",
          },
        });
        events.push({
          type: "reconciliation_requires_review",
          observationKey: `wompi:subscriber:${subscriberKey}:review:pagos:${snapshot.pagosRealizados}`,
          creditGrantAllowed: false,
          detail: { pagosRealizados: snapshot.pagosRealizados },
        });
    }
  } else {
    events.push({
      type: "snapshot_updated",
      observationKey: `wompi:subscriber:${subscriberKey}:sync:${Date.now()}`,
      creditGrantAllowed: false,
      detail: { snapshot },
    });

    const prevPagos = previous.pagosRealizados;
    const nextPagos = snapshot.pagosRealizados;

    if (prevPagos != null && nextPagos != null) {
      if (nextPagos > prevPagos) {
        pending += nextPagos - prevPagos;
        needsVerifiedTransaction = true;
        events.push({
          type: "payment_count_increased",
          observationKey: buildPagosObservationKey({
            idSuscriptor: subscriberKey,
            pagosRealizados: nextPagos,
            externalSubscriptionId: subId,
          }),
          creditGrantAllowed: false,
          detail: {
            from: prevPagos,
            to: nextPagos,
            delta: nextPagos - prevPagos,
            reason:
              "RECONCILIATION_REQUIRES_REVIEW: pagosRealizados alone is not a verified TransaccionCompra",
            retryPolicy: WOMPI_RECURRENT_RETRY,
          },
        });
        events.push({
          type: "reconciliation_requires_review",
          observationKey: `wompi:subscriber:${subscriberKey}:review:pagos:${nextPagos}`,
          creditGrantAllowed: false,
          detail: { from: prevPagos, to: nextPagos },
        });
      } else if (nextPagos === prevPagos) {
        events.push({
          type: "payment_count_unchanged",
          observationKey: `wompi:subscriber:${subscriberKey}:pagos_unchanged:${nextPagos}`,
          creditGrantAllowed: false,
          detail: { pagosRealizados: nextPagos },
        });
      } else {
        events.push({
          type: "payment_count_decreased",
          observationKey: `wompi:subscriber:${subscriberKey}:pagos_decreased:${prevPagos}->${nextPagos}`,
          creditGrantAllowed: false,
          detail: { from: prevPagos, to: nextPagos },
        });
      }
    }

    if (
      previous.wompiEstadoRaw != null &&
      snapshot.estado != null &&
      previous.wompiEstadoRaw !== snapshot.estado
    ) {
      const mapped = mapWompiEstadoSuscripcion(snapshot.estado);
      events.push({
        type: "estado_changed",
        observationKey: `wompi:subscriber:${subscriberKey}:estado:${previous.wompiEstadoRaw}->${snapshot.estado}`,
        creditGrantAllowed: false,
        detail: {
          from: previous.wompiEstadoRaw,
          to: snapshot.estado,
          label: mapped.label,
          internalStatus: mapped.internalStatus,
          source: "Wompi technical support EstadoSuscripcion map",
        },
      });
    }
  }

  // Drop ephemeral sync timestamps from observation keys that include Date.now —
  // keep first_sync / payment keys stable; mark snapshot_updated as non-unique helper.
  const stableEvents = events.filter((e) => e.type !== "snapshot_updated");

  return {
    snapshot,
    persisted: {
      external_subscription_id: snapshot.id,
      external_subscriber_id: snapshot.idSuscriptor,
      wompi_alias: snapshot.alias,
      wompi_nombre_suscriptor: snapshot.nombreSuscriptor,
      wompi_monto: snapshot.monto,
      pagos_realizados: snapshot.pagosRealizados,
      wompi_estado_raw: snapshot.estado,
      wompi_fecha_inicio: snapshot.fechaInicio,
      wompi_dia_pago: snapshot.diaPago,
      last_pagos_realizados_observed: snapshot.pagosRealizados,
      pending_unverified_payment_count: pending,
    },
    events: stableEvents,
    needsVerifiedTransaction,
  };
}

/** Official labels (Wompi technical support). */
export const WOMPI_ESTADO_SUSCRIPCION_NOTES = {
  enumValues: [0, 1, 2, 3, 4] as const,
  labels: {
    0: "Activa",
    1: "Suspendida",
    2: "Cancelada",
    3: "Finalizada",
    4: "NoDefinido",
  } as const,
  labelsPublished: true,
  source: "Wompi technical support response",
} as const;
