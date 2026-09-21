/**
 * Server-side sync of a Wompi recurrent subscription snapshot into Postgres.
 * Persists fields + observation events. NEVER grants credits.
 */

import {
  reconcileWompiSubscriptionSnapshot,
  type StoredSubscriptionSyncState,
} from "./subscriptionReconcile";
import {
  listEnlacePagoRecurrenteSuscripciones,
  loadWompiConfig,
  wompiConfigured,
  type WompiSuscripcionRecurrente,
} from "./wompi";
import { serviceClient } from "@/lib/server/auth";

export type SyncBySubscriberResult =
  | {
      ok: true;
      matched: number;
      updates: Array<{
        subscriptionId: string | null;
        externalSubscriptionId: string | null;
        needsVerifiedTransaction: boolean;
        eventTypes: string[];
      }>;
    }
  | { ok: false; code: string; error: string };

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

async function persistRemote(
  enlaceId: string,
  remote: WompiSuscripcionRecurrente
): Promise<{
  subscriptionId: string | null;
  needsVerifiedTransaction: boolean;
  eventTypes: string[];
  externalSubscriptionId: string | null;
}> {
  const sb = serviceClient();
  const idSuscriptor = remote.idSuscriptor?.trim();
  const externalSubId = remote.id?.trim();

  let existing: Record<string, unknown> | null = null;
  if (externalSubId) {
    const { data } = await sb
      .from("billing_subscriptions")
      .select("*")
      .eq("provider", "wompi")
      .eq("external_subscription_id", externalSubId)
      .maybeSingle();
    existing = data as Record<string, unknown> | null;
  }
  if (!existing && idSuscriptor) {
    const { data } = await sb
      .from("billing_subscriptions")
      .select("*")
      .eq("provider", "wompi")
      .eq("external_enlace_id", enlaceId)
      .eq("external_subscriber_id", idSuscriptor)
      .maybeSingle();
    existing = data as Record<string, unknown> | null;
  }

  const previous = existing ? rowToStored(existing) : null;
  const result = reconcileWompiSubscriptionSnapshot(previous, remote);
  const now = new Date().toISOString();

  let subscriptionId = (existing?.id as string | undefined) ?? null;

  if (existing?.id) {
    const { error } = await sb
      .from("billing_subscriptions")
      .update({
        ...result.persisted,
        external_enlace_id: enlaceId,
        last_synced_at: now,
        updated_at: now,
      })
      .eq("id", existing.id);
    if (error) {
      throw new Error(`subscription sync update failed: ${error.message}`);
    }
  }
  // Do not insert orphan subscriptions from Wompi poll alone — must be user-linked first.

  for (const ev of result.events) {
    const { error: evErr } = await sb.from("billing_subscription_sync_events").insert({
      provider: "wompi",
      subscription_id: subscriptionId,
      external_subscription_id: result.persisted.external_subscription_id,
      external_subscriber_id: result.persisted.external_subscriber_id,
      observation_key: ev.observationKey,
      event_type: ev.type,
      payload: ev.detail,
      credit_grant_allowed: false,
    });
    // Unique observation_key → already recorded (idempotent)
    if (evErr && evErr.code !== "23505") {
      throw new Error(`sync event insert failed: ${evErr.message}`);
    }
  }

  return {
    subscriptionId,
    externalSubscriptionId: result.persisted.external_subscription_id,
    needsVerifiedTransaction: result.needsVerifiedTransaction,
    eventTypes: result.events.map((e) => e.type),
  };
}

/**
 * Pull Wompi suscripciones for a shared link filtered by idSuscriptor and
 * reconcile into any matching internal billing_subscriptions rows.
 */
export async function syncWompiSubscriptionsBySubscriberId(opts: {
  enlacePagoRecurrenteId: string;
  idSuscriptor: string;
}): Promise<SyncBySubscriberResult> {
  if (!wompiConfigured()) {
    return { ok: false, code: "wompi_not_configured", error: "Wompi credentials missing" };
  }
  if (!opts.enlacePagoRecurrenteId.trim() || !opts.idSuscriptor.trim()) {
    return { ok: false, code: "invalid_input", error: "enlace id and idSuscriptor required" };
  }

  let cfg;
  try {
    cfg = loadWompiConfig();
  } catch {
    return { ok: false, code: "wompi_not_configured", error: "Wompi credentials missing" };
  }

  let remotes: WompiSuscripcionRecurrente[];
  try {
    remotes = await listEnlacePagoRecurrenteSuscripciones(cfg, opts.enlacePagoRecurrenteId, {
      idSuscriptor: opts.idSuscriptor.trim(),
      suscripcionesPorPagina: 50,
    });
  } catch (e) {
    return {
      ok: false,
      code: "wompi_list_failed",
      error: e instanceof Error ? e.message : "list failed",
    };
  }

  const updates = [];
  for (const remote of remotes) {
    updates.push(await persistRemote(opts.enlacePagoRecurrenteId, remote));
  }

  return { ok: true, matched: remotes.length, updates };
}
