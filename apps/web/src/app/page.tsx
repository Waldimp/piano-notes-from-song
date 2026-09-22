"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import AppFooter from "@/components/AppFooter";
import AppHeader from "@/components/AppHeader";
import CloudQueuePanel from "@/components/CloudQueuePanel";
import OnboardingBanner from "@/components/OnboardingBanner";
import UploadBox from "@/components/UploadBox";
import UsageBanner from "@/components/UsageBanner";
import { type JobState, type SongSummary, getDataSource } from "@/lib/data";
import { API_URL } from "@/lib/data/local";
import { jobStatusLabel } from "@/lib/userMessages";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export default function Home() {
  const data = getDataSource();
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

  useEffect(() => {
    if (data.kind !== "local") return;
    fetch(`${API_URL}/health`)
      .then((r) => r.json())
      .then((h) => setCloudReady(Boolean(h.cloud)))
      .catch(() => {});
  }, [data.kind]);

  useEffect(() => {
    if (data.kind !== "cloud") return;
    if (!jobs.some((j) => j.status === "queued" || j.status === "processing")) return;
    const t = setInterval(reload, 10000);
    return () => clearInterval(t);
  }, [data.kind, jobs, reload]);

  const pendingJobs = useMemo(() => {
    const songIds = new Set(items?.map((s) => s.id) ?? []);
    return jobs.filter(
      (j) => !(j.status === "done" && j.transcriptionId && songIds.has(j.transcriptionId)),
    );
  }, [items, jobs]);

  const showEmpty =
    data.kind === "cloud"
      ? items !== null && items.length === 0 && pendingJobs.length === 0
      : items !== null && items.length === 0;

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
      <AppHeader
        title="Tus canciones"
        subtitle={
          data.kind === "cloud"
            ? "Sube audio de piano y abre el tutorial cuando esté listo."
            : "Biblioteca local en esta PC"
        }
      />

      {data.kind === "cloud" && <OnboardingBanner />}

      <UsageBanner refreshKey={usageTick} />
      <UploadBox
        onSubmitted={() => {
          reload();
          setUsageTick((n) => n + 1);
        }}
      />

      {error && (
        <div className="notice" role="alert">
          <p style={{ margin: 0 }}>{error}</p>
          {data.kind === "local" && (
            <p style={{ margin: "0.5rem 0 0" }}>
              ¿Está corriendo el backend local? Arráncalo desde la terminal del proyecto.
            </p>
          )}
        </div>
      )}

      {showEmpty && (
        <div className="empty-state">
          <p className="empty-state-title">No tienes canciones todavía</p>
          <p className="subtitle">
            Sube un audio arriba para que Pianissimo cree tu primer tutorial interactivo.
          </p>
        </div>
      )}

      {(pendingJobs.length > 0 || (items && items.length > 0)) && (
        <ul className="song-list" aria-label="Tus canciones">
          {pendingJobs.map((j) => (
            <li key={`job-${j.id}`} className="song-item song-item-pending">
              <div className="song-link" style={{ color: "var(--text)" }}>
                <span className="song-title">{j.filename}</span>
                <span className="song-meta">
                  <span className={`status-pill status-${j.status}`}>
                    {jobStatusLabel(j.status)}
                  </span>
                  {j.createdAt ? ` · ${formatDate(j.createdAt)}` : ""}
                </span>
              </div>
              {j.status === "error" ? (
                <span className="song-actions">
                  <span className="subtitle" style={{ fontSize: "0.85rem" }}>
                    {j.error && j.error.length < 120
                      ? j.error
                      : "Algo falló al analizar esta canción. Puedes subirla de nuevo."}
                  </span>
                </span>
              ) : j.status === "done" && j.transcriptionId ? (
                <Link className="btn small active" href={`/tutorial/${j.transcriptionId}`}>
                  Abrir tutorial
                </Link>
              ) : (
                <span className="subtitle" style={{ fontSize: "0.85rem" }}>
                  Te avisaremos aquí cuando esté listo.
                </span>
              )}
            </li>
          ))}

          {items?.map((song) => (
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
                    <span className="song-title">{song.title}</span>
                    <span className="song-meta">
                      <span className="status-pill status-ready">Lista</span>
                      {" · "}
                      {formatDuration(song.duration)}
                      {song.created_at ? ` · ${formatDate(song.created_at)}` : ""}
                    </span>
                  </Link>
                  {confirmingDelete === song.id ? (
                    <span className="song-actions">
                      <button className="btn small danger" onClick={() => void submitDelete(song.id)}>
                        Eliminar
                      </button>
                      <button className="btn small" onClick={() => setConfirmingDelete(null)}>
                        Cancelar
                      </button>
                    </span>
                  ) : (
                    <span className="song-actions">
                      <Link className="btn small active" href={`/tutorial/${song.id}`}>
                        Abrir tutorial
                      </Link>
                      {data.kind === "local" && cloudReady && (
                        <button
                          className="btn small"
                          disabled={publishing === song.id}
                          onClick={() => void publish(song)}
                        >
                          {publishing === song.id ? "Publicando…" : "Publicar"}
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

      {data.kind === "cloud" && <AppFooter />}
    </main>
  );
}
