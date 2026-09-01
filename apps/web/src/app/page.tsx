"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { API_URL, fetchTranscriptionList } from "@/lib/api";

export default function Home() {
  const [items, setItems] = useState<{ id: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTranscriptionList()
      .then(setItems)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main style={styles.main}>
      <h1 style={{ marginTop: 0 }}>Piano Tutorial</h1>
      <p style={styles.subtitle}>
        Transcripciones disponibles en <code>data/output/</code>
      </p>

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
          Aún no hay transcripciones. Genera una con:{" "}
          <code>.venv\Scripts\python scripts\transcribe.py data\samples\cut_liszt.mp3</code>
        </p>
      )}

      {items && items.length > 0 && (
        <ul style={styles.list}>
          {items.map((item) => (
            <li key={item.id} style={styles.item}>
              <Link href={`/tutorial/${item.id}`} style={styles.link}>
                ▶ {item.id}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    maxWidth: 720,
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
  link: {
    display: "block",
    padding: "0.85rem 1rem",
    background: "#1a1a22",
    border: "1px solid #2c2c38",
    borderRadius: 8,
    color: "#7dd487",
    textDecoration: "none",
    fontSize: "1.05rem",
  },
};
