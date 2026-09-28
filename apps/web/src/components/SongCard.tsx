"use client";

/**
 * Tarjeta de canción como pieza musical: portada generativa, título limpio,
 * duración/estado y "abrir" como acción natural (clic en la portada, botón
 * play al pasar el ratón). Renombrar/eliminar viven en un menú contextual.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import Artwork from "@/components/Artwork";
import type { JobState, SongSummary } from "@/lib/data";
import { formatClock, isPreviewSong, previewLabel } from "@/lib/beta/preview";
import { jobErrorMessage, jobStatusLabel } from "@/lib/userMessages";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es", { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

function cleanTitle(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function PendingCard({ job }: { job: JobState }) {
  const failed = job.status === "error";
  const title = cleanTitle(job.filename);
  return (
    <li className={`tile${failed ? "" : " pending"}`}>
      <div className="tile-art" aria-hidden="true">
        <Artwork seed={title} muted />
        {job.previewSeconds ? <span className="tile-badge pill gold">Vista previa</span> : null}
      </div>
      <div className="tile-meta">
        <div>
          <div className="tile-title">{title}</div>
          <div className="tile-sub">
            <span className={`pill ${failed ? "danger" : job.status === "processing" ? "info" : ""}`}>
              {!failed && <i className="dot pulse" />}
              {jobStatusLabel(job.status)}
            </span>
            {job.createdAt ? <span>{formatDate(job.createdAt)}</span> : null}
          </div>
          <p className="muted small" style={{ marginTop: "0.35rem" }}>
            {failed ? jobErrorMessage(job.error) : "Te avisamos aquí en cuanto esté lista."}
          </p>
        </div>
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
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const preview = isPreviewSong(song);
  const label = previewLabel(song);
  const shown = cleanTitle(song.title);

  return (
    <li className="tile">
      <Link href={`/tutorial/${song.id}`} className="tile-art" aria-label={`Abrir tutorial de ${shown}`}>
        <Artwork seed={song.title} />
        {preview && <span className="tile-badge pill gold">Vista previa</span>}
        <span className="tile-play" aria-hidden="true">
          ▶
        </span>
      </Link>

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
          <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Nuevo título" maxLength={120} />
          <button type="submit" className="btn small primary">
            Guardar
          </button>
          <button type="button" className="btn small ghost" onClick={() => setRenaming(false)} aria-label="Cancelar">
            ✕
          </button>
        </form>
      ) : confirming ? (
        <div className="row">
          <span className="small muted">¿Eliminar esta canción?</span>
          <button className="btn xs danger" type="button" onClick={() => void onDelete(song.id)}>
            Eliminar
          </button>
          <button className="btn xs ghost" type="button" onClick={() => setConfirming(false)}>
            Cancelar
          </button>
        </div>
      ) : (
        <div className="tile-meta">
          <div style={{ minWidth: 0 }}>
            <Link href={`/tutorial/${song.id}`} className="tile-title">
              {shown}
            </Link>
            <div className="tile-sub">
              {label ? <span className="pill warn">{label}</span> : <span>{formatClock(song.duration)}</span>}
              <span>· {song.note_count} notas</span>
            </div>
            {preview && onUnlock && (
              <button className="btn link small" type="button" style={{ marginTop: "0.35rem" }} onClick={() => onUnlock(song)}>
                Desbloquear canción completa
              </button>
            )}
          </div>
          <div className="menu-wrap" ref={menuRef}>
            <button
              type="button"
              className="btn icon ghost"
              aria-haspopup="menu"
              aria-expanded={menu}
              aria-label={`Más acciones para ${shown}`}
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
    </li>
  );
}
