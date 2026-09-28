"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ALLOWED_AUDIO_EXTENSIONS, MAX_UPLOAD_BYTES } from "@/lib/beta/limits";
import { FREE_PREVIEW_SECONDS } from "@/lib/beta/preview";
import { getDataSource } from "@/lib/data";
import type { UsageInfo } from "@/components/UsageBanner";

const ACCEPT_LIST = [...ALLOWED_AUDIO_EXTENSIONS].join(", ");
const MAX_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; name: string }
  | { kind: "waiting"; name: string; jobId: string; status: string; queuePosition: number | null; startedAt: number }
  | { kind: "queued-cloud"; name: string }
  | { kind: "error"; message: string };

function validateFile(file: File): string | null {
  const ext = file.name.match(/\.[^.]+$/i)?.[0]?.toLowerCase() ?? "";
  if (!ALLOWED_AUDIO_EXTENSIONS.has(ext)) {
    return `Formato no admitido. Usa ${ACCEPT_LIST.replaceAll(".", "").toUpperCase()}.`;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `El archivo supera ${MAX_MB} MB.`;
  }
  return null;
}

export default function UploadBox({
  usage,
  onSubmitted,
}: {
  usage: UsageInfo | null;
  onSubmitted?: () => void;
}) {
  const router = useRouter();
  const data = getDataSource();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (phase.kind !== "waiting") return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - phase.startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const jobId = phase.kind === "waiting" ? phase.jobId : null;
  useEffect(() => {
    if (!jobId) return;
    const poll = setInterval(async () => {
      try {
        const job = await data.getJob(jobId);
        if (job.status === "done" && job.transcriptionId) {
          clearInterval(poll);
          router.push(`/tutorial/${job.transcriptionId}`);
        } else if (job.status === "error") {
          clearInterval(poll);
          setPhase({
            kind: "error",
            message: "No pudimos analizar esta canción. Prueba otro audio o un fragmento más corto.",
          });
        } else {
          setPhase((p) =>
            p.kind === "waiting" ? { ...p, status: job.status, queuePosition: job.queuePosition } : p,
          );
        }
      } catch {
        clearInterval(poll);
        setPhase({ kind: "error", message: "Perdimos la conexión. Revisa tu red e inténtalo de nuevo." });
      }
    }, 2000);
    return () => clearInterval(poll);
  }, [jobId, data, router]);

  const submit = async (file: File) => {
    const validation = validateFile(file);
    if (validation) {
      setPhase({ kind: "error", message: validation });
      return;
    }
    setPhase({ kind: "uploading", name: file.name });
    try {
      const id = await data.submitAudio(file);
      if (data.kind === "cloud") {
        setPhase({ kind: "queued-cloud", name: file.name });
        onSubmitted?.();
        return;
      }
      setElapsed(0);
      setPhase({ kind: "waiting", name: file.name, jobId: id, status: "queued", queuePosition: null, startedAt: Date.now() });
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const busy = phase.kind === "uploading" || phase.kind === "waiting";
  const isFree = usage?.plan_code === "free";
  const noCredits = usage != null && usage.credit_balance <= 0;
  const className = `dropzone${dragOver ? " drag" : ""}${busy ? " busy" : ""}`;

  const limitCopy =
    usage == null
      ? "MP3, WAV, M4A, FLAC u OGG · hasta 25 MB"
      : isFree
        ? `Cualquier canción · creamos una vista previa de ${FREE_PREVIEW_SECONDS} s · hasta ${MAX_MB} MB`
        : `Hasta ${Math.round(usage.max_duration_seconds / 60)} minutos por canción · hasta ${MAX_MB} MB`;

  return (
    <div
      className={className}
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file && !busy) void submit(file);
      }}
    >
      <div className="dropzone-icon" aria-hidden="true">
        ♪
      </div>

      {phase.kind === "idle" && (
        <>
          <div>
            <h3>{noCredits ? "Sin tutoriales disponibles" : "Sube una canción de piano"}</h3>
            <p>
              {noCredits
                ? "Consigue un Mini Pack para seguir creando tutoriales completos."
                : limitCopy}
            </p>
          </div>
          {noCredits ? (
            <Link className="btn primary" href="/pricing">
              Ver precios
            </Link>
          ) : (
            <button className="btn primary" type="button" onClick={() => inputRef.current?.click()}>
              Elegir archivo
            </button>
          )}
        </>
      )}

      {phase.kind === "uploading" && (
        <>
          <div>
            <h3>Subiendo {phase.name}…</h3>
            <p>Mantén esta pestaña abierta un momento.</p>
            <div className="progress">
              <span />
            </div>
          </div>
          <span />
        </>
      )}

      {phase.kind === "waiting" && (
        <>
          <div>
            <h3>{phase.status === "queued" ? "Preparando tu canción…" : "Analizando las notas…"}</h3>
            <p>
              {phase.name} · {elapsed}s
              {phase.queuePosition !== null && phase.queuePosition > 1 ? ` · posición ${phase.queuePosition} en cola` : ""}
              . Al terminar abrimos el tutorial.
            </p>
            <div className="progress">
              <span />
            </div>
          </div>
          <span />
        </>
      )}

      {phase.kind === "queued-cloud" && (
        <>
          <div>
            <h3>¡Canción recibida!</h3>
            <p>
              {phase.name} ya está en cola. Verás el progreso aquí abajo y podrás abrir el tutorial en cuanto
              esté listo (suele tardar un minuto).
            </p>
          </div>
          <button className="btn" type="button" onClick={() => setPhase({ kind: "idle" })}>
            Subir otra
          </button>
        </>
      )}

      {phase.kind === "error" && (
        <>
          <div>
            <h3 style={{ color: "var(--danger)" }}>No pudimos subirla</h3>
            <p>{phase.message}</p>
          </div>
          <div className="row">
            {noCredits && (
              <Link className="btn primary small" href="/pricing">
                Ver precios
              </Link>
            )}
            <button className="btn small" type="button" onClick={() => setPhase({ kind: "idle" })}>
              Intentar de nuevo
            </button>
          </div>
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_LIST}
        hidden
        aria-label="Elegir archivo de audio"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void submit(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
