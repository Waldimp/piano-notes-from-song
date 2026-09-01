"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import UploadBox from "@/components/UploadBox";
import { API_URL, type SongSummary, fetchTranscriptionList } from "@/lib/api";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function Home() {
  const [items, setItems] = useState<SongSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetchTranscriptionList()
      .then((list) => {
        setItems(list);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(reload, [reload]);

  const submitRename = async (id: string) => {
    const title = newTitle.trim();
    setRenaming(null);
    if (!title) return;
    await fetch(`${API_URL}/api/transcriptions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    reload();
  };

  const submitDelete = async (id: string) => {
    setConfirmingDelete(null);
    await fetch(`${API_URL}/api/transcriptions/${id}`, { method: "DELETE" });
    reload();
  };

  return (
    <main style={styles.main}>
      <h1 style={{ marginTop: 0 }}>Piano Tutorial</h1>
      <p style={styles.subtitle}>Tu biblioteca local de canciones transcritas</p>

      <UploadBox />

      {error && (
        <div style={styles.error}>
          <p>No se pudo contactar el backend ({error}).</p>
          <p>
            Arráncalo con:{" "}
            <code>
              .venv\Scripts\python -m uvicorn app.main:app --app-dir apps\api --port 8010
            </code>{" "}
            (API esperada en {API_URL})
          </p>
        </div>
      )}

      {items && items.length === 0 && (
        <p>
          Aún no hay canciones. Sube una arriba, o desde la terminal:{" "}
          <code>.venv\Scripts\python scripts\transcribe.py data\samples\cut_liszt.mp3</code>
        </p>
      )}

      {items && items.length > 0 && (
        <ul style={styles.list}>
          {items.map((song) => (
            <li key={song.id} style={styles.item}>
              <div style={styles.row}>
                {renaming === song.id ? (
                  <form
                    style={{ flex: 1, display: "flex", gap: "0.5rem" }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submitRename(song.id);
                    }}
                  >
                    <input
                      autoFocus
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      style={styles.input}
                      aria-label="Nuevo título"
                    />
                    <button type="submit" style={styles.smallButton}>
                      Guardar
                    </button>
                    <button
                      type="button"
                      style={styles.smallButton}
                      onClick={() => setRenaming(null)}
                    >
                      Cancelar
                    </button>
                  </form>
                ) : (
                  <>
                    <Link href={`/tutorial/${song.id}`} style={styles.link}>
                      <span style={styles.title}>▶ {song.title}</span>
                      <span style={styles.meta}>
                        {formatDuration(song.duration)} · {song.note_count} notas ·{" "}
                        {song.filename}
                      </span>
                    </Link>
                    {confirmingDelete === song.id ? (
                      <span style={styles.actions}>
                        <button
                          style={{ ...styles.smallButton, ...styles.danger }}
                          onClick={() => void submitDelete(song.id)}
                        >
                          Eliminar definitivamente
                        </button>
                        <button
                          style={styles.smallButton}
                          onClick={() => setConfirmingDelete(null)}
                        >
                          Cancelar
                        </button>
                      </span>
                    ) : (
                      <span style={styles.actions}>
                        <button
                          style={styles.smallButton}
                          onClick={() => {
                            setNewTitle(song.title);
                            setRenaming(song.id);
                          }}
                        >
                          Renombrar
                        </button>
                        <button
                          style={styles.smallButton}
                          onClick={() => setConfirmingDelete(song.id)}
                        >
                          Eliminar
                        </button>
                      </span>
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    maxWidth: 780,
    margin: "0 auto",
    padding: "2.5rem 1.5rem",
    minHeight: "100vh",
    background: "#0e0e14",
    color: "#e8e6e0",
  },
  subtitle: { color: "#8b8b98" },
  error: {
    border: "1px solid #7a3b33",
    background: "#241214",
    borderRadius: 8,
    padding: "0.75rem 1rem",
  },
  list: { listStyle: "none", padding: 0 },
  item: { margin: "0.5rem 0" },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.7rem 1rem",
    background: "#1a1a22",
    border: "1px solid #2c2c38",
    borderRadius: 8,
  },
  link: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "0.15rem",
    color: "#7dd487",
    textDecoration: "none",
    minWidth: 0,
  },
  title: { fontSize: "1.05rem" },
  meta: { color: "#8b8b98", fontSize: "0.82rem" },
  actions: { display: "inline-flex", gap: "0.4rem", flexShrink: 0 },
  smallButton: {
    background: "#23232e",
    color: "#e8e6e0",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#3a3a46",
    borderRadius: 6,
    padding: "0.3rem 0.6rem",
    cursor: "pointer",
    fontSize: "0.82rem",
  },
  danger: { borderColor: "#7a3b33", color: "#e08b7d" },
  input: {
    flex: 1,
    background: "#0e0e14",
    color: "#e8e6e0",
    border: "1px solid #3a3a46",
    borderRadius: 6,
    padding: "0.35rem 0.6rem",
    fontSize: "0.95rem",
  },
};
