/**
 * Pure helpers for subscription webhook correlation and period keys.
 * No DB / service role imports — safe for unit tests.
 *
 * Period identity (financial):
 *   one legitimate monthly renewal → one grant
 * Barriers:
 *   1) unique(subscription_id, period_key)  — cycle identity
 *   2) unique(provider, external_transaction_id) — same tx never grants twice
 *
 * Period key does NOT embed transaction id (that would allow two approved txs
 * in the same billing cycle to each create a grant).
 */

/** America/El_Salvador (UTC−6, no DST). */
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

export type ElSalvadorDateParts = { year: number; month: number; day: number };

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

export function elSalvadorDateParts(isoOrNow?: string): ElSalvadorDateParts {
  const d = isoOrNow ? new Date(isoOrNow) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  const utc = safe.getTime() + safe.getTimezoneOffset() * 60_000;
  const sv = new Date(utc - 6 * 60 * 60_000);
  return {
    year: sv.getUTCFullYear(),
    month: sv.getUTCMonth() + 1,
    day: sv.getUTCDate(),
  };
}

/** Calendar date YYYY-MM-DD in America/El_Salvador. */
export function periodDayInElSalvador(isoOrNow?: string): string {
  const { year, month, day } = elSalvadorDateParts(isoOrNow);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  let y = year;
  let m = month + delta;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return { year: y, month: m };
}

function formatCycle(year: number, month: number): string {
  return `cycle:${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Deterministic monthly billing-cycle id.
 *
 * When `diaPago` (Wompi 1–31) is known:
 * - Cycle is anchored on that day-of-month in America/El_Salvador.
 * - Wompi retries on billing day + next day → a payment on diaPago+1
 *   (or day 1 after diaPago=31) still maps to the same cycle.
 * - A payment before this month's diaPago maps to the previous cycle
 *   (covers month-boundary retry after diaPago=28–31).
 *
 * When `diaPago` is unknown:
 * - Fall back to calendar YYYY-MM of the transaction (conservative:
 *   at most one grant per calendar month; never invent diaPago).
 *
 * Does not use IdTransaccion in the key.
 */
export function buildMonthlyBillingPeriodKey(opts: {
  transactionTimestamp?: string | null;
  /** Wompi diaPago 1–31 when known from subscription snapshot. */
  diaPago?: number | null;
}): string {
  const parts = elSalvadorDateParts(opts.transactionTimestamp ?? undefined);
  const rawDia = opts.diaPago;

  if (rawDia == null || !Number.isFinite(rawDia) || rawDia < 1 || rawDia > 31) {
    return formatCycle(parts.year, parts.month);
  }

  const diaPago = Math.floor(rawDia);
  const dim = daysInMonth(parts.year, parts.month);
  const effectiveDia = Math.min(diaPago, dim);

  // Retry window: billing day and the following calendar day (Wompi User Terms).
  // If tx day is before this month's effective diaPago, it belongs to the previous cycle
  // (e.g. diaPago=31, retry on day 1 of next month).
  if (parts.day < effectiveDia) {
    const prev = shiftMonth(parts.year, parts.month, -1);
    return formatCycle(prev.year, prev.month);
  }

  return formatCycle(parts.year, parts.month);
}

/**
 * @deprecated Prefer buildMonthlyBillingPeriodKey — kept as alias for callers.
 * Transaction id is intentionally ignored for period identity.
 */
export function buildSubscriptionPeriodKey(opts: {
  externalTransactionId?: string;
  transactionTimestamp?: string | null;
  diaPago?: number | null;
}): string {
  return buildMonthlyBillingPeriodKey({
    transactionTimestamp: opts.transactionTimestamp,
    diaPago: opts.diaPago,
  });
}
