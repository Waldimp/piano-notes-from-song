"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  ALLOWED_AUDIO_EXTENSIONS,
  MAX_UPLOAD_BYTES,
} from "@/lib/beta/limits";
import { getDataSource } from "@/lib/data";
import { supabase } from "@/lib/supabase";
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
    return `Formato no admitido. Usa: ${ACCEPT_LIST.replaceAll(",", " ")}`;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `El archivo supera ${MAX_MB} MB.`;
  }
  return null;
}

export default function UploadBox({ onSubmitted }: { onSubmitted?: () => void }) {
  const router = useRouter();
  const data = getDataSource();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadUsage = useCallback(async () => {
    if (data.kind !== "cloud") return;
    const { data: session } = await supabase().auth.getSession();
    const token = session.session?.access_token;
    if (!token) return;
    const res = await fetch("/api/usage", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) setUsage(body.usage as UsageInfo);
  }, [data.kind]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  useEffect(() => {
    if (phase.kind !== "waiting") return;
    const t = setInterval(
      () => setElapsed(Math.round((Date.now() - phase.startedAt) / 1000)),
      1000,
    );
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
            message:
              "No pudimos analizar esta canción. Prueba otro audio o un fragmento más corto.",
          });
        } else {
          setPhase((p) =>
            p.kind === "waiting" ? { ...p, status: job.status, queuePosition: job.queuePosition } : p,
          );
        }
      } catch {
        clearInterval(poll);
        setPhase({
          kind: "error",
          message: "Perdimos la conexión. Revisa tu red e inténtalo de nuevo.",
        });
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
        void loadUsage();
        onSubmitted?.();
        return;
      }
      setElapsed(0);
      setPhase({
        kind: "waiting",
        name: file.name,
        jobId: id,
        status: "queued",
        queuePosition: null,
        startedAt: Date.now(),
      });
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const busy = phase.kind === "uploading" || phase.kind === "waiting";
  const className = `upload-box${dragOver ? " drag" : ""}${busy ? " busy" : ""}`;

  const durationHint =
    usage != null
      ? usage.max_duration_seconds <= 60
        ? "hasta 1 minuto"
        : `hasta ${Math.round(usage.max_duration_seconds / 60)} minutos`
      : "según tu plan";

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
      {phase.kind === "idle" && (
        <>
          <p className="title">Subir una canción</p>
          <p className="detail">
            {ACCEPT_LIST.replaceAll(",", " ")} · máx. {MAX_MB} MB · {durationHint}
            {usage != null && (
              <>
                <br />
                Tutoriales disponibles: <strong>{usage.credit_balance}</strong>
              </>
            )}
            <br />
            <button className="btn" type="button" onClick={() => inputRef.current?.click()}>
              Elegir archivo
            </button>
          </p>
        </>
      )}

      {phase.kind === "uploading" && (
        <>
          <p className="title">Subiendo {phase.name}…</p>
          <p className="detail">Mantén esta pestaña abierta un momento.</p>
        </>
      )}

      {phase.kind === "waiting" && (
        <>
          <p className="title">
            {phase.status === "queued" ? "Preparando tu canción…" : "Analizando las notas…"}{" "}
            {phase.name} ({elapsed}s)
          </p>
          <p className="detail">
            {phase.queuePosition !== null && phase.queuePosition > 1
              ? `Posición en cola: ${phase.queuePosition}. `
              : ""}
            Al terminar abriremos el tutorial automáticamente.
          </p>
        </>
      )}

      {phase.kind === "queued-cloud" && (
        <>
          <p className="title">Canción recibida: {phase.name}</p>
          <p className="detail">
            Está en cola. Verás el progreso abajo en Tus canciones hasta que el tutorial esté listo.
            <br />
            <button className="btn small" type="button" onClick={() => setPhase({ kind: "idle" })}>
              Subir otra
            </button>
          </p>
        </>
      )}

      {phase.kind === "error" && (
        <>
          <p className="title" style={{ color: "var(--red)" }}>
            {phase.message}
          </p>
          <p className="detail">
            {usage != null && usage.credit_balance <= 0 && (
              <>
                <Link className="btn small" href="/pricing">
                  Ver precios
                </Link>{" "}
              </>
            )}
            <button className="btn small" type="button" onClick={() => setPhase({ kind: "idle" })}>
              Intentar de nuevo
            </button>
          </p>
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
