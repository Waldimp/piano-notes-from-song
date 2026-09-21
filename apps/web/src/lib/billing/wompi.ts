import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Wompi El Salvador config from official docs:
 * https://docs.wompi.sv/autenticacion/autenticacion
 * https://docs.wompi.sv/webhook/validar-webhook
 *
 * Panel mapping:
 * - App ID → WOMPI_CLIENT_ID (OAuth client_id)
 * - API Secret → WOMPI_CLIENT_SECRET (OAuth client_secret + webhook HMAC key)
 * - idAplicativo: docs say clientIdApi is generally the same as idAplicativo /
 *   "APP ID dentro del panel". Optional WOMPI_APLICATIVO_ID overrides; otherwise
 *   defaults to WOMPI_CLIENT_ID (no third secret required).
 */
export type WompiEnvConfig = {
  clientId: string;
  clientSecret: string;
  audience: string;
  tokenUrl: string;
  apiBaseUrl: string;
  aplicativoId: string;
  /** Expected EsProductiva / esReal for this deployment. */
  expectProductive: boolean;
  appPublicUrl: string;
};

export function wompiConfigured(): boolean {
  return Boolean(process.env.WOMPI_CLIENT_ID && process.env.WOMPI_CLIENT_SECRET);
}

export function billingEnabled(): boolean {
  return process.env.BILLING_ENABLED === "true" && wompiConfigured();
}

/** Subscriptions stay off until recurrent lifecycle is documented end-to-end. */
export function billingSubscriptionsEnabled(): boolean {
  return process.env.BILLING_SUBSCRIPTIONS_ENABLED === "true" && billingEnabled();
}

export function loadWompiConfig(): WompiEnvConfig {
  const clientId = process.env.WOMPI_CLIENT_ID?.trim();
  const clientSecret = process.env.WOMPI_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("wompi credentials not configured");
  }
  // Official docs: clientIdApi is generally the same as idAplicativo / App ID.
  const aplicativoId = process.env.WOMPI_APLICATIVO_ID?.trim() || clientId;
  return {
    clientId,
    clientSecret,
    audience: process.env.WOMPI_AUDIENCE?.trim() || "wompi_api",
    tokenUrl: process.env.WOMPI_TOKEN_URL?.trim() || "https://id.wompi.sv/connect/token",
    apiBaseUrl: (process.env.WOMPI_API_BASE_URL?.trim() || "https://api.wompi.sv").replace(/\/$/, ""),
    aplicativoId,
    expectProductive: process.env.WOMPI_EXPECT_PRODUCTIVE === "true",
    appPublicUrl: (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || "").replace(/\/$/, ""),
  };
}

/** HMAC-SHA256 hex of raw body using API Secret (docs: Validar Webhook). */
export function computeWompiWebhookHash(rawBody: string, apiSecret: string): string {
  return createHmac("sha256", apiSecret).update(rawBody, "utf8").digest("hex");
}

export function verifyWompiWebhookHash(
  rawBody: string,
  headerHash: string | null,
  apiSecret: string
): boolean {
  if (!headerHash || !apiSecret) return false;
  const expected = computeWompiWebhookHash(rawBody, apiSecret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(headerHash.trim().toLowerCase(), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

let cachedToken: { value: string; expiresAtMs: number } | null = null;

export async function fetchWompiAccessToken(cfg: WompiEnvConfig): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAtMs > now + 60_000) {
    return cachedToken.value;
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    audience: cfg.audience,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`wompi token failed: ${res.status}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) throw new Error("wompi token missing access_token");
  cachedToken = {
    value: json.access_token,
    expiresAtMs: now + (json.expires_in ?? 3600) * 1000,
  };
  return json.access_token;
}

export type CreateEnlacePagoInput = {
  identificadorEnlaceComercio: string;
  monto: number;
  nombreProducto: string;
  descripcionProducto?: string;
  urlRedirect: string;
  urlWebhook: string;
  urlRetorno?: string;
};

export type CreateEnlacePagoResult = {
  idEnlace: number;
  urlEnlace: string;
  urlQrCodeEnlace?: string;
  estaProductivo: boolean;
};

/** POST /EnlacePago — hosted checkout (no card data on our servers). */
export async function createEnlacePago(
  cfg: WompiEnvConfig,
  input: CreateEnlacePagoInput
): Promise<CreateEnlacePagoResult> {
  const token = await fetchWompiAccessToken(cfg);
  const payload = {
    identificadorEnlaceComercio: input.identificadorEnlaceComercio,
    monto: input.monto,
    nombreProducto: input.nombreProducto,
    infoProducto: {
      descripcionProducto: input.descripcionProducto ?? input.nombreProducto,
    },
    configuracion: {
      urlRedirect: input.urlRedirect,
      urlRetorno: input.urlRetorno ?? input.urlRedirect,
      urlWebhook: input.urlWebhook,
      esMontoEditable: false,
      esCantidadEditable: false,
      cantidadPorDefecto: 1,
      notificarTransaccionCliente: true,
    },
    limitesDeUso: {
      cantidadMaximaPagosExitosos: 1,
      cantidadMaximaPagosFallidos: 5,
    },
  };
  const res = await fetch(`${cfg.apiBaseUrl}/EnlacePago`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`wompi EnlacePago failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    idEnlace?: number;
    urlEnlace?: string;
    urlQrCodeEnlace?: string;
    estaProductivo?: boolean;
  };
  if (json.idEnlace == null || !json.urlEnlace) {
    throw new Error("wompi EnlacePago response incomplete");
  }
  return {
    idEnlace: json.idEnlace,
    urlEnlace: json.urlEnlace,
    urlQrCodeEnlace: json.urlQrCodeEnlace,
    estaProductivo: Boolean(json.estaProductivo),
  };
}

export type CreateEnlacePagoRecurrenteInput = {
  diaDePago: number;
  nombre: string;
  idAplicativo: string;
  monto: number;
  descripcionProducto: string;
};

export type CreateEnlacePagoRecurrenteResult = {
  idEnlace: string;
  urlEnlace: string;
  urlEnlaceLargo?: string;
  estaProductivo: boolean;
  urlQrCodeEnlace?: string;
};

/**
 * POST /EnlacePagoRecurrente — creates a shared recurring link product.
 *
 * Confirmed (docs + OpenAPI): shared plan link with urlEnlace for manual affiliation.
 * NOT implemented here: per-subscriber credit grants (correlation undocumented).
 */
export async function createEnlacePagoRecurrente(
  cfg: WompiEnvConfig,
  input: CreateEnlacePagoRecurrenteInput
): Promise<CreateEnlacePagoRecurrenteResult> {
  const token = await fetchWompiAccessToken(cfg);
  const res = await fetch(`${cfg.apiBaseUrl}/EnlacePagoRecurrente`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      diaDePago: input.diaDePago,
      nombre: input.nombre,
      idAplicativo: input.idAplicativo,
      monto: input.monto,
      descripcionProducto: input.descripcionProducto,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`wompi EnlacePagoRecurrente failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    idEnlace?: string;
    urlEnlace?: string;
    urlEnlaceLargo?: string;
    estaProductivo?: boolean;
    urlQrCodeEnlace?: string;
  };
  if (!json.idEnlace || !json.urlEnlace) {
    throw new Error("wompi EnlacePagoRecurrente response incomplete");
  }
  return {
    idEnlace: json.idEnlace,
    urlEnlace: json.urlEnlace,
    urlEnlaceLargo: json.urlEnlaceLargo,
    estaProductivo: Boolean(json.estaProductivo),
    urlQrCodeEnlace: json.urlQrCodeEnlace,
  };
}

/** GET /EnlacePagoRecurrente/{id} — shared recurring link metadata. */
export async function getEnlacePagoRecurrente(
  cfg: WompiEnvConfig,
  idEnlace: string
): Promise<Record<string, unknown>> {
  const token = await fetchWompiAccessToken(cfg);
  const res = await fetch(
    `${cfg.apiBaseUrl}/EnlacePagoRecurrente/${encodeURIComponent(idEnlace)}`,
    {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
    }
  );
  if (!res.ok) {
    throw new Error(`wompi EnlacePagoRecurrente GET failed: ${res.status}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

export type WompiSuscripcionRecurrente = {
  id?: string;
  fechaCreacion?: string;
  alias?: string;
  monto?: number;
  pagosRealizados?: number;
  /** Undocumented enum 0–4 in OpenAPI — do not invent labels. */
  estado?: number;
  idSuscriptor?: string;
  nombreSuscriptor?: string;
  fechaInicio?: string;
  diaPago?: number;
};

/**
 * GET /EnlacePagoRecurrente/{id}/suscripciones
 * Lists individual affiliations on a shared recurring link (OpenAPI confirmed).
 */
export async function listEnlacePagoRecurrenteSuscripciones(
  cfg: WompiEnvConfig,
  idEnlace: string,
  query?: {
    idSuscriptor?: string;
    paginaActual?: number;
    suscripcionesPorPagina?: number;
    /** Raw EstadoSuscripcion 0–4; OpenAPI default filter described as Activa. */
    estado?: number;
  }
): Promise<WompiSuscripcionRecurrente[]> {
  const token = await fetchWompiAccessToken(cfg);
  const qs = new URLSearchParams();
  if (query?.idSuscriptor) qs.set("IdSuscriptor", query.idSuscriptor);
  if (query?.paginaActual != null) qs.set("PaginaActual", String(query.paginaActual));
  if (query?.suscripcionesPorPagina != null) {
    qs.set("SuscripcionesPorPagina", String(query.suscripcionesPorPagina));
  }
  if (query?.estado != null) qs.set("Estado", String(query.estado));
  const suffix = qs.toString() ? `?${qs}` : "";
  const res = await fetch(
    `${cfg.apiBaseUrl}/EnlacePagoRecurrente/${encodeURIComponent(idEnlace)}/suscripciones${suffix}`,
    {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
    }
  );
  if (!res.ok) {
    throw new Error(`wompi EnlacePagoRecurrente suscripciones failed: ${res.status}`);
  }
  const json = (await res.json()) as
    | WompiSuscripcionRecurrente[]
    | { resultado?: WompiSuscripcionRecurrente[] };
  if (Array.isArray(json)) return json;
  return json.resultado ?? [];
}

/**
 * POST /EnlacePagoRecurrente/{id} — disables the ENTIRE shared recurring link.
 * OpenAPI: "Desactiva un enlace de pago recurrente".
 * MUST NOT be used as per-user cancel (would affect all affiliates).
 */
export async function disableEnlacePagoRecurrente(
  cfg: WompiEnvConfig,
  idEnlace: string
): Promise<Record<string, unknown>> {
  const token = await fetchWompiAccessToken(cfg);
  const res = await fetch(
    `${cfg.apiBaseUrl}/EnlacePagoRecurrente/${encodeURIComponent(idEnlace)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
    }
  );
  if (!res.ok) {
    throw new Error(`wompi EnlacePagoRecurrente disable failed: ${res.status}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

export type WompiTransaction = {
  idTransaccion?: string;
  esReal?: boolean;
  esAprobada?: boolean;
  monto?: number;
  montoOriginal?: number;
  mensaje?: string;
  codigoAutorizacion?: string;
  idExterno?: string;
};

/** GET /TransaccionCompra/{id} — server confirmation after webhook. */
export async function getTransaccionCompra(
  cfg: WompiEnvConfig,
  idTransaccion: string
): Promise<WompiTransaction> {
  const token = await fetchWompiAccessToken(cfg);
  const res = await fetch(
    `${cfg.apiBaseUrl}/TransaccionCompra/${encodeURIComponent(idTransaccion)}`,
    {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
    }
  );
  if (!res.ok) {
    throw new Error(`wompi TransaccionCompra failed: ${res.status}`);
  }
  return (await res.json()) as WompiTransaction;
}

export function amountsMatch(expected: number, actual: number | undefined | null): boolean {
  if (actual == null || Number.isNaN(Number(actual))) return false;
  return Math.abs(Number(actual) - expected) < 0.005;
}

/** Test helper: clear cached OAuth token between tests. */
export function clearWompiTokenCache(): void {
  cachedToken = null;
}
