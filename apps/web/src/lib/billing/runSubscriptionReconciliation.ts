/**
 * Daily subscription reconciliation worker (NOT a payment worker).
 * Wompi charges; this job only syncs snapshots and flags unverifiable deltas.
 */

import {
  reconcileWompiSubscriptionSnapshot,
  type StoredSubscriptionSyncState,
} from "./subscriptionReconcile";
import { mapWompiEstadoSuscripcion } from "./wompiSubscriptionStatus";
import {
  listEnlacePagoRecurrenteSuscripciones,
  loadWompiConfig,
  wompiConfigured,
  type WompiSuscripcionRecurrente,
} from "./wompi";
import { serviceClient } from "@/lib/server/auth";

export type ReconciliationMetrics = {
  scanned: number;
  synced: number;
  changed: number;
  verified_payments: number;
  unverifiable_payment_deltas: number;
  errors: number;
  requires_review: number;
};

function rowToStored(row: Record<string, unknown>): StoredSubscriptionSyncState {
  return {
    externalSubscriptionId: (row.external_subscription_id as string | null) ?? null,
    externalSubscriberId: (row.external_subscriber_id as string | null) ?? null,
    pagosRealizados:
      row.pagos_realizados == null ? null : Number(row.pagos_realizados),
    wompiEstadoRaw: row.wompi_estado_raw == null ? null : Number(row.wompi_estado_raw),
    wompiFechaInicio: (row.wompi_fecha_inicio as string | null) ?? null,
    wompiDiaPago: row.wompi_dia_pago == null ? null : Number(row.wompi_dia_pago),
    pendingUnverifiedPaymentCount: Number(row.pending_unverified_payment_count ?? 0),
  };
}

async function reconcileOneRow(row: Record<string, unknown>): Promise<{
  changed: boolean;
  unverifiable: boolean;
  error?: string;
}> {
  const enlaceId = (row.external_enlace_id as string | null)?.trim();
  if (!enlaceId) {
    return { changed: false, unverifiable: false, error: "missing_enlace" };
  }

  const cfg = loadWompiConfig();
  const idSuscriptor = (row.external_subscriber_id as string | null)?.trim();
  const extSubId = (row.external_subscription_id as string | null)?.trim();

  let remotes: WompiSuscripcionRecurrente[];
  try {
    remotes = await listEnlacePagoRecurrenteSuscripciones(cfg, enlaceId, {
      idSuscriptor: idSuscriptor || undefined,
      suscripcionesPorPagina: 50,
    });
  } catch (e) {
    return {
      changed: false,
      unverifiable: false,
      error: e instanceof Error ? e.message : "list_failed",
    };
  }

  let remote: WompiSuscripcionRecurrente | undefined;
  if (extSubId) {
    remote = remotes.find((r) => r.id?.trim() === extSubId);
  }
  if (!remote && idSuscriptor) {
    remote = remotes.find((r) => r.idSuscriptor?.trim() === idSuscriptor);
  }
  if (!remote && remotes.length === 1) {
    remote = remotes[0];
  }
  if (!remote) {
    return { changed: false, unverifiable: false, error: "remote_not_found" };
  }

  const previous = rowToStored(row);
  const result = reconcileWompiSubscriptionSnapshot(previous, remote);
  const mapped = mapWompiEstadoSuscripcion(result.persisted.wompi_estado_raw);
  const now = new Date().toISOString();
  const sb = serviceClient();

  const statusUpdate =
    mapped.internalStatus && mapped.internalStatus !== "undefined"
      ? mapped.internalStatus
      : undefined;

  const reconciliationStatus = result.needsVerifiedTransaction
    ? "requires_review"
    : "ok";

  const { error } = await sb
    .from("billing_subscriptions")
    .update({
      ...result.persisted,
      ...(statusUpdate ? { status: statusUpdate } : {}),
      reconciliation_status: reconciliationStatus,
      last_reconciled_at: now,
      last_synced_at: now,
      updated_at: now,
    })
    .eq("id", row.id);

  if (error) {
    return { changed: false, unverifiable: false, error: error.message };
  }

  for (const ev of result.events) {
    const eventType =
      ev.type === "payment_count_increased"
        ? "subscription.reconciliation_anomaly"
        : ev.type === "estado_changed"
          ? `subscription.${mapped.label ?? "reconciled"}`
          : "subscription.reconciled";

    await sb.from("billing_subscription_sync_events").insert({
      provider: "wompi",
      subscription_id: row.id,
      external_subscription_id: result.persisted.external_subscription_id,
      external_subscriber_id: result.persisted.external_subscriber_id,
      observation_key: ev.observationKey,
      event_type: eventType,
      payload: {
        ...ev.detail,
        reconciliation: true,
        credit_grant_allowed: false,
        note:
          ev.type === "payment_count_increased"
            ? "RECONCILIATION_REQUIRES_REVIEW: no verified TransaccionCompra id from list APIs"
            : undefined,
      },
      credit_grant_allowed: false,
    });
  }

  return {
    changed: result.events.length > 0 || Boolean(statusUpdate),
    unverifiable: result.needsVerifiedTransaction,
  };
}

/**
 * Scan open subscriptions and sync Wompi snapshots.
 * Never grants credits. Never initiates charges.
 * One row failure does not abort the batch.
 */
export async function runSubscriptionReconciliation(opts?: {
  limit?: number;
}): Promise<{ ok: true; metrics: ReconciliationMetrics }> {
  const metrics: ReconciliationMetrics = {
    scanned: 0,
    synced: 0,
    changed: 0,
    verified_payments: 0,
    unverifiable_payment_deltas: 0,
    errors: 0,
    requires_review: 0,
  };

  if (!wompiConfigured()) {
    return { ok: true, metrics };
  }

  const sb = serviceClient();
  const limit = opts?.limit ?? 100;
  const { data: rows, error } = await sb
    .from("billing_subscriptions")
    .select("*")
    .eq("provider", "wompi")
    .in("status", ["pending", "active", "suspended", "past_due"])
    .not("external_enlace_id", "is", null)
    .order("last_reconciled_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error || !rows) {
    metrics.errors += 1;
    return { ok: true, metrics };
  }

  for (const row of rows) {
    metrics.scanned += 1;
    try {
      const r = await reconcileOneRow(row as Record<string, unknown>);
      if (r.error) {
        metrics.errors += 1;
        continue;
      }
      metrics.synced += 1;
      if (r.changed) metrics.changed += 1;
      if (r.unverifiable) {
        metrics.unverifiable_payment_deltas += 1;
        metrics.requires_review += 1;
      }
      // verified_payments stays 0 until official list-tx-by-subscription exists
    } catch {
      metrics.errors += 1;
    }
  }

  return { ok: true, metrics };
}
