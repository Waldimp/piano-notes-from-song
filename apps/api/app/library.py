"""Biblioteca local de canciones (SQLite, sin servidores).

La fuente de verdad del CONTENIDO sigue siendo data/output/ (notes.json,
audio, midi); la DB guarda metadata y el titulo editable. list_songs hace
backfill automatico: cualquier carpeta valida sin fila en la DB se registra
al vuelo, asi las transcripciones hechas por CLI tambien aparecen.
"""

from __future__ import annotations

import json
import logging
import shutil
import sqlite3
from pathlib import Path
from typing import Optional

logger = logging.getLogger("piano.library")

REPO_ROOT = Path(__file__).resolve().parents[3]
DB_PATH = REPO_ROOT / "data" / "library.db"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)  # conexion por operacion: seguro entre hilos
    conn.row_factory = sqlite3.Row
    return conn


def ensure_schema() -> None:
    """Aplica migraciones pendientes al arrancar el API."""
    import sys

    sys.path.insert(0, str(REPO_ROOT / "scripts"))
    from migrate import apply_migrations  # type: ignore[import-not-found]

    applied = apply_migrations(DB_PATH)
    if applied:
        logger.info("Migraciones aplicadas: %s", ", ".join(applied))


def upsert_song(song_id: str, notes_path: Path) -> None:
    """Registra/actualiza la metadata de una transcripcion desde su notes.json."""
    try:
        data = json.loads(notes_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("No se pudo leer %s para la biblioteca: %s", notes_path, exc)
        return
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO songs (id, title, filename, duration, note_count, pedal_count, engine)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                filename = excluded.filename,
                duration = excluded.duration,
                note_count = excluded.note_count,
                pedal_count = excluded.pedal_count,
                engine = excluded.engine
            """,
            (
                song_id,
                song_id,  # titulo inicial = id; el usuario lo renombra despues
                data.get("source", {}).get("filename", ""),
                float(data.get("duration", 0)),
                len(data.get("notes", [])),
                len(data.get("pedals", [])),
                data.get("transcription", {}).get("engine", ""),
            ),
        )


def list_songs(output_dir: Path) -> list[dict]:
    """Lista canciones con metadata, backfilleando carpetas sin registro."""
    on_disk = {
        d.name: d / "notes.json"
        for d in sorted(output_dir.iterdir())
        if d.is_dir() and (d / "notes.json").is_file()
    } if output_dir.is_dir() else {}

    with _connect() as conn:
        known = {row["id"] for row in conn.execute("SELECT id FROM songs")}

    for song_id, notes_path in on_disk.items():
        if song_id not in known:
            upsert_song(song_id, notes_path)

    with _connect() as conn:
        rows = conn.execute("SELECT * FROM songs ORDER BY created_at DESC").fetchall()

    # Solo canciones que siguen existiendo en disco (la DB puede tener huerfanas
    # si alguien borro la carpeta a mano; se omiten sin romper nada).
    return [dict(row) for row in rows if row["id"] in on_disk]


def rename_song(song_id: str, title: str) -> bool:
    title = title.strip()
    if not title:
        return False
    with _connect() as conn:
        cur = conn.execute("UPDATE songs SET title = ? WHERE id = ?", (title, song_id))
        return cur.rowcount > 0


def delete_song(song_id: str, output_dir: Path) -> None:
    """Elimina la carpeta de la transcripcion y su fila en la biblioteca."""
    target = output_dir / song_id
    if target.is_dir():
        shutil.rmtree(target)
    with _connect() as conn:
        conn.execute("DELETE FROM songs WHERE id = ?", (song_id,))
