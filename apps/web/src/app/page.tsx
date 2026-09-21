"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthGate";
import CloudQueuePanel from "@/components/CloudQueuePanel";
import UploadBox from "@/components/UploadBox";
import UsageBanner from "@/components/UsageBanner";
import { type JobState, type SongSummary, getDataSource } from "@/lib/data";
import { API_URL } from "@/lib/data/local";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const STATUS_LABEL: Record<JobState["status"], string> = {
  queued: "En cola — esperando procesamiento",
  processing: "Transcribiendo…",
  done: "Lista",
  error: "Error",
};

export default function Home() {
  const data = getDataSource();
  const { email, signOut } = useAuth();
  const [items, setItems] = useState<SongSummary[] | null>(null);
  const [jobs, setJobs] = useState<JobState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [cloudReady, setCloudReady] = useState(false);
  const [usageTick, setUsageTick] = useState(0);

  const reload = useCallback(() => {
    data
      .listSongs()
      .then((list) => {
        setItems(list);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
    data.listJobs().then(setJobs).catch(() => {});
  }, [data]);

  useEffect(reload, [reload]);

  // Modo local: ¿tiene el backend Supabase configurado para "Publicar"?
  useEffect(() => {
    if (data.kind !== "local") return;
    fetch(`${API_URL}/health`)
      .then((r) => r.json())
      .then((h) => setCloudReady(Boolean(h.cloud)))
      .catch(() => {});
  }, [data.kind]);

  // En la nube, refrescar solicitudes pendientes cada 10 s.
  useEffect(() => {
    if (data.kind !== "cloud") return;
    if (!jobs.some((j) => j.status === "queued" || j.status === "processing")) return;
    const t = setInterval(reload, 10000);
    return () => clearInterval(t);
  }, [data.kind, jobs, reload]);

  const submitRename = async (id: string) => {
    const title = newTitle.trim();
    setRenaming(null);
    if (!title) return;
    await data.renameSong(id, title).catch((e: Error) => setError(e.message));
    reload();
  };

  const submitDelete = async (id: string) => {
    setConfirmingDelete(null);
    await data.deleteSong(id).catch((e: Error) => setError(e.message));
    reload();
  };

  const publish = async (song: SongSummary) => {
    setPublishing(song.id);
    try {
      const res = await fetch(`${API_URL}/api/transcriptions/${song.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: song.title }),
      });
      if (!res.ok) throw new Error((await res.json()).detail ?? res.statusText);
    } catch (e) {
      setError(`No se pudo publicar: ${e instanceof Error ? e.message : e}`);
    } finally {
      setPublishing(null);
    }
  };

  return (
    <main className="home">
      <div className="topbar">
        <div>
          <h1>🎹 Piano Tutorial</h1>
          <p className="subtitle" style={{ margin: 0 }}>
            {data.kind === "cloud" ? "Tu biblioteca de canciones" : "Biblioteca local (esta PC)"}
          </p>
        </div>
        {email && (
          <span className="who">
            {email}
            <button className="btn small" onClick={() => void signOut()}>
              Salir
            </button>
          </span>
        )}
      </div>

      <UsageBanner refreshKey={usageTick} />
      <UploadBox
        onSubmitted={() => {
          reload();
          setUsageTick((n) => n + 1);
        }}
      />

      {error && (
        <div className="notice">
          <p style={{ margin: 0 }}>{error}</p>
          {data.kind === "local" && (
            <p style={{ margin: "0.5rem 0 0" }}>
              ¿Está corriendo el backend? Arráncalo con:{" "}
              <code>.venv\Scripts\python -m uvicorn app.main:app --app-dir apps\api --port 8010</code>
            </p>
          )}
        </div>
      )}

      {items && items.length === 0 && (
        <p className="subtitle">
          Aún no hay canciones.{" "}
          {data.kind === "cloud"
            ? "Sube un audio arriba: se transcribirá automáticamente cuando el procesamiento en la nube esté activo."
            : "Sube una arriba o transcribe desde la terminal."}
        </p>
      )}

      {items && items.length > 0 && (
        <ul className="song-list">
          {items.map((song) => (
            <li key={song.id} className="song-item">
              {renaming === song.id ? (
                <form
                  className="rename-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitRename(song.id);
                  }}
                >
                  <input
                    className="input"
                    autoFocus
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    aria-label="Nuevo título"
                  />
                  <button type="submit" className="btn small active">
                    Guardar
                  </button>
                  <button type="button" className="btn small" onClick={() => setRenaming(null)}>
                    Cancelar
                  </button>
                </form>
              ) : (
                <>
                  <Link href={`/tutorial/${song.id}`} className="song-link">
                    <span className="song-title">▶ {song.title}</span>
                    <span className="song-meta">
                      {formatDuration(song.duration)} · {song.note_count} notas
                    </span>
                  </Link>
                  {confirmingDelete === song.id ? (
                    <span className="song-actions">
                      <button className="btn small danger" onClick={() => void submitDelete(song.id)}>
                        Eliminar definitivamente
                      </button>
                      <button className="btn small" onClick={() => setConfirmingDelete(null)}>
                        Cancelar
                      </button>
                    </span>
                  ) : (
                    <span className="song-actions">
                      {data.kind === "local" && cloudReady && (
                        <button
                          className="btn small"
                          disabled={publishing === song.id}
                          onClick={() => void publish(song)}
                          title="Subir a la nube para verla desde el celular"
                        >
                          {publishing === song.id ? "Publicando…" : "☁ Publicar"}
                        </button>
                      )}
                      <button
                        className="btn small"
                        onClick={() => {
                          setNewTitle(song.title);
                          setRenaming(song.id);
                        }}
                      >
                        Renombrar
                      </button>
                      <button className="btn small" onClick={() => setConfirmingDelete(song.id)}>
                        Eliminar
                      </button>
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {data.kind === "local" && cloudReady && <CloudQueuePanel onProcessed={reload} />}

      {data.kind === "cloud" && (
        <>
          <h2 className="section-title">Solicitudes</h2>
          {jobs.length === 0 && (
            <p className="subtitle" style={{ fontSize: "0.9rem" }}>
              No hay solicitudes pendientes. Cuando subas una canción aparecerá aquí con su
              estado; el control plane la envía a Modal si el modo operativo lo permite.
            </p>
          )}
          {jobs.map((j) => (
            <div key={j.id} className="request-item">
              <span style={{ overflowWrap: "anywhere" }}>{j.filename}</span>
              <span className={`status ${j.status}`}>
                {j.status === "done" && j.transcriptionId ? (
                  <Link href={`/tutorial/${j.transcriptionId}`} style={{ color: "inherit" }}>
                    Lista → abrir
                  </Link>
                ) : j.status === "error" ? (
                  `Error: ${j.error ?? ""}`
                ) : (
                  STATUS_LABEL[j.status]
                )}
              </span>
            </div>
          ))}
        </>
      )}
    </main>
  );
}
