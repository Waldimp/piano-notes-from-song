/**
 * Pure helpers for subscription webhook correlation and period keys.
 * No DB / service role imports — safe for unit tests.
 */

import { buildPeriodKey } from "./subscriptions";

/** America/El_Salvador (UTC−6, no DST) — document for period day keys. */
export const SUBSCRIPTION_PERIOD_TIMEZONE = "America/El_Salvador";

export type SubscriptionWebhookHints = {
  IdSuscripcion?: string;
  idSuscripcion?: string;
  IdTransaccion?: string;
  Monto?: number;
  EsProductiva?: boolean;
  FechaTransaccion?: string;
  ModuloUtilizado?: string;
  EnlacePago?: {
    Id?: number | string;
    IdentificadorEnlaceComercio?: string;
    NombreProducto?: string;
  };
  EstadoSuscripcion?: number;
};

export function extractIdSuscripcion(payload: SubscriptionWebhookHints): string | null {
  const a = payload.IdSuscripcion?.trim();
  const b = payload.idSuscripcion?.trim();
  return a || b || null;
}

export function extractEnlacePagoId(payload: SubscriptionWebhookHints): string | null {
  const id = payload.EnlacePago?.Id;
  if (id == null) return null;
  return String(id).trim() || null;
}

/** Calendar date YYYY-MM-DD in America/El_Salvador. */
export function periodDayInElSalvador(isoOrNow?: string): string {
  const d = isoOrNow ? new Date(isoOrNow) : new Date();
  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  const utc = d.getTime() + d.getTimezoneOffset() * 60_000;
  const sv = new Date(utc - 6 * 60 * 60_000);
  const y = sv.getUTCFullYear();
  const m = String(sv.getUTCMonth() + 1).padStart(2, "0");
  const day = String(sv.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Period key: billing-day (SV) + transaction id.
 * Transaction uniqueness is also enforced by DB unique(provider, external_transaction_id).
 */
export function buildSubscriptionPeriodKey(opts: {
  externalTransactionId: string;
  transactionTimestamp?: string | null;
}): string {
  const day = periodDayInElSalvador(opts.transactionTimestamp ?? undefined);
  return buildPeriodKey({
    periodStartIso: `${day}T12:00:00.000Z`,
    externalTransactionId: opts.externalTransactionId,
  });
}
