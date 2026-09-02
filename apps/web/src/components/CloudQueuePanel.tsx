"use client";

/**
 * Panel local (solo en tu PC): cola de solicitudes de la nube con
 * "Procesar ahora" y "Escuchar mientras el backend esté abierto".
 * Habla con el backend FastAPI, que usa el modelo ya cargado.
 */

import { useCallback, useEffect, useState } from "react";

import { API_URL } from "@/lib/data/local";

interface CloudRequest {
  id: string;
  filename: string;
  status: "queued" | "processing" | "done" | "error";
  error: string | null;
  created_at: string;
  song_id: string | null;
}

interface PanelStatus {
  running: boolean;
  listening: boolean;
  processedTotal: number;
  lastRun: string | null;
  lastError: string | null;
  log: string[];
}

const STATUS_LABEL: Record<CloudRequest["status"], string> = {
  queued: "En cola",
  processing: "Transcribiendo…",
  done: "Lista",
  error: "Error",
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function CloudQueuePanel({ onProcessed }: { onProcessed?: () => void }) {
  const [requests, setRequests] = useState<CloudRequest[] | null>(null);
  const [status, setStatus] = useState<PanelStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([
        fetch(`${API_URL}/api/cloud/requests`, { cache: "no-store" }),
        fetch(`${API_URL}/api/cloud/status`, { cache: "no-store" }),
      ]);
      if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
      setRequests(await r.json());
      setStatus(await s.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Mientras procesa o escucha, refrescar seguido; si no, cada 20 s.
  const active = Boolean(status?.running || status?.listening);
  useEffect(() => {
    const t = setInterval(refresh, active ? 3000 : 20000);
    return () => clearInterval(t);
  }, [active, refresh]);

  // Cuando termina un procesamiento, avisar para recargar la biblioteca local.
  const wasRunning = status?.running;
  useEffect(() => {
    if (wasRunning === false) onProcessed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wasRunning]);

  const processNow = async () => {
    await fetch(`${API_URL}/api/cloud/process`, { method: "POST" });
    void refresh();
  };

  const toggleListen = async () => {
    await fetch(`${API_URL}/api/cloud/listen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !status?.listening }),
    });
    void refresh();
  };

  const pending = requests?.filter((r) => r.status === "queued" || r.status === "processing") ?? [];

  return (
    <section className="cloud-panel">
      <div className="cloud-panel-head">
        <h2 className="section-title" style={{ margin: 0 }}>
          ☁ Solicitudes en la nube
          {pending.length > 0 && <span className="badge">{pending.length}</span>}
        </h2>
        <span className="group">
          <button
            className="btn small active"
            onClick={() => void processNow()}
            disabled={!status || status.running}
          >
            {status?.running ? "Procesando…" : "▶ Procesar ahora"}
          </button>
          <button
            className={`btn small${status?.listening ? " listening" : ""}`}
            onClick={() => void toggleListen()}
            disabled={!status}
            title="Revisa la cola cada 15 s mientras el backend esté abierto"
          >
            {status?.listening ? "● Escuchando (detener)" : "Escuchar automáticamente"}
          </button>
        </span>
      </div>

      {error && <div className="notice">No se pudo leer la cola: {error}</div>}

      {requests && requests.length === 0 && (
        <p className="subtitle" style={{ fontSize: "0.9rem" }}>
          Nadie ha pedido canciones todavía. Cuando tu hermana suba una desde la web aparecerá aquí.
        </p>
      )}

      {requests && requests.length > 0 && (
        <div>
          {requests.map((r) => (
            <div key={r.id} className="request-item">
              <span style={{ overflowWrap: "anywhere" }}>
                {r.filename}
                <span className="song-meta"> · {formatWhen(r.created_at)}</span>
              </span>
              <span className={`status ${r.status}`}>
                {r.status === "error" ? `Error: ${r.error ?? ""}` : STATUS_LABEL[r.status]}
              </span>
            </div>
          ))}
        </div>
      )}

      {status && (
        <p className="subtitle" style={{ fontSize: "0.8rem", margin: "0.5rem 0 0" }}>
          Procesadas en esta sesión: {status.processedTotal}
          {status.lastRun ? ` · última pasada ${new Date(status.lastRun).toLocaleTimeString("es")}` : ""}
          {" · "}
          <button className="btn link" onClick={() => setShowLog((v) => !v)}>
            {showLog ? "ocultar registro" : "ver registro"}
          </button>
        </p>
      )}

      {showLog && status && (
        <pre className="cloud-log">{status.log.length ? status.log.join("\n") : "(sin actividad aún)"}</pre>
      )}
    </section>
  );
}
