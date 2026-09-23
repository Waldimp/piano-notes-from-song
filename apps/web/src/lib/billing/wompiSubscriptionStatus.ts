/**
 * Official Wompi EstadoSuscripcion mapping (technical support response).
 * Do not scatter magic numbers; store raw alongside mapped status.
 */

export const WOMPI_ESTADO_SUSCRIPCION = {
  0: "active",
  1: "suspended",
  2: "cancelled",
  3: "finished",
  4: "undefined",
} as const;

export type WompiEstadoSuscripcionCode = keyof typeof WOMPI_ESTADO_SUSCRIPCION;
export type WompiEstadoSuscripcionLabel =
  (typeof WOMPI_ESTADO_SUSCRIPCION)[WompiEstadoSuscripcionCode];

/** Internal billing_subscriptions.status values derived from Wompi. */
export type InternalSubscriptionStatus =
  | "pending"
  | "active"
  | "suspended"
  | "cancelled"
  | "finished"
  | "undefined"
  | "past_due"
  | "expired";

export type MappedWompiEstado = {
  raw: number | null;
  known: boolean;
  label: WompiEstadoSuscripcionLabel | null;
  /** Safe local status for DB; null when raw is missing/unexpected. */
  internalStatus: InternalSubscriptionStatus | null;
  /** Financial effects allowed from status alone (never grants). */
  allowsNewGrants: boolean;
};

/**
 * Map raw EstadoSuscripcion 0–4.
 * Unexpected values → known=false, no financial side effects.
 */
export function mapWompiEstadoSuscripcion(raw: number | undefined | null): MappedWompiEstado {
  if (raw === undefined || raw === null || Number.isNaN(Number(raw))) {
    return {
      raw: null,
      known: false,
      label: null,
      internalStatus: null,
      allowsNewGrants: false,
    };
  }
  const n = Number(raw);
  if (n === 0) {
    return {
      raw: 0,
      known: true,
      label: "active",
      internalStatus: "active",
      allowsNewGrants: true,
    };
  }
  if (n === 1) {
    return {
      raw: 1,
      known: true,
      label: "suspended",
      internalStatus: "suspended",
      allowsNewGrants: false,
    };
  }
  if (n === 2) {
    return {
      raw: 2,
      known: true,
      label: "cancelled",
      internalStatus: "cancelled",
      allowsNewGrants: false,
    };
  }
  if (n === 3) {
    return {
      raw: 3,
      known: true,
      label: "finished",
      internalStatus: "finished",
      allowsNewGrants: false,
    };
  }
  if (n === 4) {
    return {
      raw: 4,
      known: true,
      label: "undefined",
      internalStatus: "undefined",
      allowsNewGrants: false,
    };
  }
  return {
    raw: n,
    known: false,
    label: null,
    internalStatus: null,
    allowsNewGrants: false,
  };
}

/** Spanish UI labels when feature is shown. */
export function subscriptionStatusDisplayEs(status: string): string {
  switch (status) {
    case "active":
      return "Activa";
    case "suspended":
    case "past_due":
      return "Suspendida";
    case "cancelled":
      return "Cancelada";
    case "finished":
    case "expired":
      return "Finalizada";
    case "undefined":
      return "No definida";
    case "pending":
      return "Pendiente";
    default:
      return status;
  }
}
