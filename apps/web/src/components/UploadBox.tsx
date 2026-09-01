"use client";

/**
 * Subida de audio → job de transcripción en background → tutorial.
 * Hace polling de GET /api/jobs/{id} cada 2 s hasta done/error.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { API_URL } from "@/lib/api";

const ACCEPT = ".wav,.mp3,.m4a,.flac,.ogg";

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; name: string }
  | { kind: "waiting"; name: string; jobId: string; status: string; queuePosition: number | null; startedAt: number }
  | { kind: "error"; message: string };

export default function UploadBox() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cronómetro visible mientras el job corre.
  useEffect(() => {
    if (phase.kind !== "waiting") return;
    const t = setInterval(
      () => setElapsed(Math.round((Date.now() - phase.startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(t);
  }, [phase]);

  // Polling del estado del job.
  useEffect(() => {
    if (phase.kind !== "waiting") return;
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/api/jobs/${phase.jobId}`);
        if (!res.ok) throw new Error(`estado ${res.status}`);
        const job = await res.json();
        if (job.status === "done") {
          clearInterval(poll);
          router.push(`/tutorial/${job.transcription_id}`);
        } else if (job.status === "error") {
          clearInterval(poll);
          setPhase({ kind: "error", message: job.error ?? "La transcripción falló" });
        } else {
          setPhase({ ...phase, status: job.status, queuePosition: job.queuePosition });
        }
      } catch (e) {
        clearInterval(poll);
        setPhase({ kind: "error", message: `Se perdió el contacto con el backend (${e})` });
      }
    }, 2000);
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind === "waiting" ? phase.jobId : null]);

  const submit = async (file: File) => {
    setPhase({ kind: "uploading", name: file.name });
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`${API_URL}/api/jobs`, { method: "POST", body });
      if (!res.ok) {
        const detail = await res.json().then((d) => d.detail).catch(() => res.statusText);
        throw new Error(detail);
      }
      const { jobId } = await res.json();
      setElapsed(0);
      setPhase({
        kind: "waiting",
        name: file.name,
        jobId,
        status: "queued",
        queuePosition: null,
        startedAt: Date.now(),
      });
    } catch (e) {
      setPhase({ kind: "error", message: String(e instanceof Error ? e.message : e) });
    }
  };

  const busy = phase.kind === "uploading" || phase.kind === "waiting";

  return (
    <div
      style={{
        ...styles.box,
        ...(dragOver ? styles.boxDrag : {}),
        ...(busy ? styles.boxBusy : {}),
      }}
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
          <p style={styles.title}>Transcribir una canción nueva</p>
          <p style={styles.detail}>
            Arrastra un audio de piano aquí ({ACCEPT}) o{" "}
            <button style={styles.linkButton} onClick={() => inputRef.current?.click()}>
              elige un archivo
            </button>
          </p>
        </>
      )}

      {phase.kind === "uploading" && <p style={styles.title}>Subiendo {phase.name}…</p>}

      {phase.kind === "waiting" && (
        <>
          <p style={styles.title}>
            {phase.status === "queued" ? "En cola" : "Transcribiendo"} {phase.name}… ({elapsed}s)
          </p>
          <p style={styles.detail}>
            {phase.queuePosition !== null && phase.queuePosition > 1
              ? `Posición en la cola: ${phase.queuePosition}. `
              : ""}
            Una canción de 3–5 min tarda ~1 minuto en GPU. Al terminar se abre el tutorial.
          </p>
        </>
      )}

      {phase.kind === "error" && (
        <>
          <p style={{ ...styles.title, color: "#e08b7d" }}>Error: {phase.message}</p>
          <p style={styles.detail}>
            <button style={styles.linkButton} onClick={() => setPhase({ kind: "idle" })}>
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

const styles: Record<string, React.CSSProperties> = {
  box: {
    border: "2px dashed #3a3a46",
    borderRadius: 10,
    padding: "1.4rem 1.2rem",
    textAlign: "center",
    marginBottom: "1.5rem",
    transition: "border-color 0.15s, background 0.15s",
  },
  boxDrag: { borderColor: "#7dd487", background: "#16201a" },
  boxBusy: { borderStyle: "solid", borderColor: "#3a5a46" },
  title: { margin: "0 0 0.35rem", fontSize: "1rem" },
  detail: { margin: 0, color: "#8b8b98", fontSize: "0.88rem" },
  linkButton: {
    background: "none",
    border: "none",
    color: "#7dd487",
    cursor: "pointer",
    textDecoration: "underline",
    fontSize: "inherit",
    padding: 0,
  },
};
