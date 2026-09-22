/** User-facing copy for API / RPC errors (no internal IDs). */

export function mapCreateRequestError(payload: {
  code?: string;
  message?: string;
  error?: string;
  status?: number;
}): string {
  const code = payload.code;
  switch (code) {
    case "no_credits":
      return "No te quedan tutoriales disponibles. Revisa Precios para obtener más.";
    case "duration_exceeded":
      return "El audio supera la duración máxima de tu plan. Prueba con un fragmento más corto o mejora tu plan.";
    case "active_limit":
      return "Ya tienes una canción en proceso. Espera a que termine antes de subir otra.";
    case "rate_limited":
      return "Has subido varios archivos muy seguido. Espera un momento e inténtalo de nuevo.";
    case "invalid_type":
      return "Formato no admitido. Usa MP3, WAV, M4A, FLAC u OGG.";
    case "too_large":
      return "El archivo es demasiado grande (máximo 25 MB).";
    case "bad_audio":
      return "No pudimos leer la duración del audio. Prueba otro archivo o conviértelo a MP3.";
    case "missing_upload":
      return "No encontramos la subida. Vuelve a elegir el archivo.";
    default:
      break;
  }
  if (payload.status === 401) {
    return "Tu sesión expiró. Vuelve a iniciar sesión e inténtalo de nuevo.";
  }
  const raw = payload.message || payload.error;
  if (raw && !looksTechnical(raw)) return raw;
  return "No pudimos preparar tu canción. Inténtalo de nuevo o contacta soporte si persiste.";
}

function looksTechnical(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("rpc") ||
    lower.includes("pgrst") ||
    lower.includes("jwt") ||
    lower.includes("authorize_beta") ||
    lower.includes("stack")
  );
}

export function mapBillingCheckoutError(body: {
  error?: string;
  code?: string;
}): string {
  if (body.code === "billing_disabled") {
    return "Los pagos no están disponibles en este momento. Inténtalo más tarde.";
  }
  if (body.code === "subscriptions_disabled") {
    return "Las suscripciones mensuales llegarán pronto.";
  }
  return body.error ?? "No pudimos abrir el pago. Inténtalo de nuevo.";
}

export const SONG_STATUS_LABEL: Record<
  "queued" | "processing" | "ready" | "error",
  string
> = {
  queued: "En cola",
  processing: "Analizando las notas…",
  ready: "Lista",
  error: "Error",
};

export function jobStatusLabel(status: "queued" | "processing" | "done" | "error"): string {
  if (status === "done") return SONG_STATUS_LABEL.ready;
  return SONG_STATUS_LABEL[status];
}
