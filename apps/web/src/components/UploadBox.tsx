"use client";

/**
 * Subida de audio → job/solicitud → tutorial.
 * Local: el backend transcribe en background y al terminar abre el tutorial.
 * Nube: crea una solicitud que el control plane despacha a Modal cuando el
 * modo operativo lo permite; aquí solo se informa el estado.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { getDataSource } from "@/lib/data";

const ACCEPT = ".wav,.mp3,.m4a,.flac,.ogg";

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; name: string }
  | { kind: "waiting"; name: string; jobId: string; status: string; queuePosition: number | null; startedAt: number }
  | { kind: "queued-cloud"; name: string }
  | { kind: "error"; message: string };

export default function UploadBox({ onSubmitted }: { onSubmitted?: () => void }) {
  const router = useRouter();
  const data = getDataSource();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cronómetro visible mientras el job local corre.
  useEffect(() => {
    if (phase.kind !== "waiting") return;
    const t = setInterval(
      () => setElapsed(Math.round((Date.now() - phase.startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(t);
  }, [phase]);

  // Polling del estado del job (solo modo local: en la nube se muestra la lista de solicitudes).
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
          setPhase({ kind: "error", message: job.error ?? "La transcripción falló" });
        } else {
          setPhase((p) =>
            p.kind === "waiting" ? { ...p, status: job.status, queuePosition: job.queuePosition } : p,
          );
        }
      } catch (e) {
        clearInterval(poll);
        setPhase({ kind: "error", message: `Se perdió el contacto con el backend (${e})` });
      }
    }, 2000);
    return () => clearInterval(poll);
  }, [jobId, data, router]);

  const submit = async (file: File) => {
    setPhase({ kind: "uploading", name: file.name });
    try {
      const id = await data.submitAudio(file);
      if (data.kind === "cloud") {
        setPhase({ kind: "queued-cloud", name: file.name });
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
          <p className="title">Transcribir una canción nueva</p>
          <p className="detail">
            Audio de piano ({ACCEPT.replaceAll(",", " ")})
            <br />
            <button className="btn" type="button" onClick={() => inputRef.current?.click()}>
              Elegir archivo
            </button>
          </p>
        </>
      )}

      {phase.kind === "uploading" && <p className="title">Subiendo {phase.name}…</p>}

      {phase.kind === "waiting" && (
        <>
          <p className="title">
            {phase.status === "queued" ? "En cola" : "Transcribiendo"} {phase.name}… ({elapsed}s)
          </p>
          <p className="detail">
            {phase.queuePosition !== null && phase.queuePosition > 1
              ? `Posición en la cola: ${phase.queuePosition}. `
              : ""}
            Una canción de 3–5 min tarda ~1 minuto en GPU. Al terminar se abre el tutorial.
          </p>
        </>
      )}

      {phase.kind === "queued-cloud" && (
        <>
          <p className="title">✅ Solicitud enviada: {phase.name}</p>
          <p className="detail">
            Se encoló correctamente. Cuando el procesamiento en la nube esté activo, Modal la
            transcribirá automáticamente. Puedes seguir el estado en la lista de solicitudes.
            <br />
            <button className="btn small" type="button" onClick={() => setPhase({ kind: "idle" })}>
              Enviar otra
            </button>
          </p>
        </>
      )}

      {phase.kind === "error" && (
        <>
          <p className="title" style={{ color: "var(--red)" }}>
            Error: {phase.message}
          </p>
          <p className="detail">
            <button className="btn small" type="button" onClick={() => setPhase({ kind: "idle" })}>
              Intentar de nuevo
            </button>
          </p>
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void submit(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
