"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import type { JobState, SongSummary } from "@/lib/data";
import { formatClock, isPreviewSong, previewLabel } from "@/lib/beta/preview";
import { jobErrorMessage, jobStatusLabel } from "@/lib/userMessages";

/** Tono determinista por título: cada canción tiene su propia "portada". */
export function hueFor(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h % 360;
}

function barsFor(seed: string): number[] {
  const out: number[] = [];
  let h = hueFor(seed) + 7;
  for (let i = 0; i < 9; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    out.push(25 + (h % 70));
  }
  return out;
}

function Art({ seed, label, badge, pending }: { seed: string; label: string; badge?: string; pending?: boolean }) {
  const bars = barsFor(seed);
  return (
    <div className="song-art" style={{ ["--hue" as string]: hueFor(seed) }} aria-hidden="true">
      <div className="bars">
        {bars.map((h, i) => (
          <i key={i} style={{ ["--h" as string]: `${h}%`, animationDelay: pending ? `${i * 0.12}s` : undefined }} />
        ))}
      </div>
      <span className="glyph">{label}</span>
      {badge && <span className="badge pill gold">{badge}</span>}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es", { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

export function PendingCard({ job }: { job: JobState }) {
  const failed = job.status === "error";
  return (
    <li className="card song-card pending">
      <Art seed={job.filename} label="♪" pending={!failed} badge={job.previewSeconds ? "Vista previa" : undefined} />
      <div className="song-body">
        <div className="song-title">{job.filename.replace(/\.[^.]+$/, "")}</div>
        <div className="song-meta">
          <span className={`pill ${failed ? "danger" : job.status === "processing" ? "info" : ""}`}>
            {!failed && <i className="dot pulse" />}
            {jobStatusLabel(job.status)}
          </span>
          {job.createdAt ? <span>{formatDate(job.createdAt)}</span> : null}
        </div>
        <p className="muted small" style={{ marginTop: "0.4rem" }}>
          {failed ? jobErrorMessage(job.error) : "Te avisamos aquí en cuanto el tutorial esté listo."}
        </p>
      </div>
    </li>
  );
}

type Props = {
  song: SongSummary;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onUnlock?: (song: SongSummary) => void;
  extraActions?: React.ReactNode;
};

export default function SongCard({ song, onRename, onDelete, onUnlock, extraActions }: Props) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [title, setTitle] = useState(song.title);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menu]);

  const preview = isPreviewSong(song);
  const label = previewLabel(song);

  return (
    <li className="card song-card">
      <Link href={`/tutorial/${song.id}`} aria-label={`Abrir tutorial de ${song.title}`}>
        <Art seed={song.title} label="♪" badge={preview ? "Vista previa" : undefined} />
      </Link>
      <div className="song-body">
        {renaming ? (
          <form
            className="rename-form"
            onSubmit={(e) => {
              e.preventDefault();
              const t = title.trim();
              setRenaming(false);
              if (t && t !== song.title) void onRename(song.id, t);
            }}
          >
            <input
              className="input"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Nuevo título"
              maxLength={120}
            />
            <button type="submit" className="btn small primary">
              Guardar
            </button>
            <button type="button" className="btn small ghost" onClick={() => setRenaming(false)}>
              ✕
            </button>
          </form>
        ) : (
          <div className="song-title">{song.title}</div>
        )}
        <div className="song-meta">
          {label ? (
            <span className="pill warn">{label}</span>
          ) : (
            <span>{formatClock(song.duration)}</span>
          )}
          <span>{song.note_count} notas</span>
          {song.created_at ? <span>· {formatDate(song.created_at)}</span> : null}
        </div>

        {confirming ? (
          <div className="song-actions">
            <button className="btn small danger" type="button" onClick={() => void onDelete(song.id)}>
              Eliminar
            </button>
            <button className="btn small ghost" type="button" onClick={() => setConfirming(false)}>
              Cancelar
            </button>
          </div>
        ) : (
          <div className="song-actions">
            <Link className="btn primary" href={`/tutorial/${song.id}`}>
              ▶ Abrir tutorial
            </Link>
            {preview && onUnlock && (
              <button className="btn small" type="button" onClick={() => onUnlock(song)} title="Procesar la canción completa">
                Completa
              </button>
            )}
            <div className="menu-wrap" ref={menuRef}>
              <button
                type="button"
                className="btn icon ghost"
                aria-haspopup="menu"
                aria-expanded={menu}
                aria-label="Más acciones"
                onClick={() => setMenu((v) => !v)}
              >
                ⋯
              </button>
              {menu && (
                <div className="menu" role="menu">
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setMenu(false);
                      setTitle(song.title);
                      setRenaming(true);
                    }}
                  >
                    Renombrar
                  </button>
                  {extraActions}
                  <button
                    role="menuitem"
                    type="button"
                    className="danger"
                    onClick={() => {
                      setMenu(false);
                      setConfirming(true);
                    }}
                  >
                    Eliminar
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </li>
  );
}
