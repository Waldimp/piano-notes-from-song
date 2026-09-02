"""Cliente Supabase y publicacion de canciones desde la PC local.

Usa la SERVICE_ROLE key (salta RLS): solo debe existir en tu PC, en .env.
Nunca va al frontend ni a git.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

from dotenv import load_dotenv
from supabase import Client, create_client

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / ".env")

AUDIO_BUCKET = "audio"
NOTES_BUCKET = "notes"
UPLOADS_BUCKET = "uploads"

MEDIA_TYPES = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
}


class CloudNotConfigured(RuntimeError):
    """Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env."""


def is_configured() -> bool:
    return bool(os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))


def get_client() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise CloudNotConfigured(
            "Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env (ver .env.example)"
        )
    return create_client(url, key)


def slugify(name: str) -> str:
    """Mismo criterio que el API local: id seguro derivado del nombre de archivo."""
    stem = Path(name).stem
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._")
    return stem or "audio"


def _upload(client: Client, bucket: str, path: str, data: bytes, content_type: str) -> None:
    client.storage.from_(bucket).upload(
        path, data, {"content-type": content_type, "upsert": "true"}
    )


def publish_song(song_dir: Path, title: str | None = None, client: Client | None = None) -> dict:
    """Sube audio + notes.json de data/output/<id>/ a Storage y upsertea la fila.

    Devuelve la fila publicada.
    """
    client = client or get_client()
    song_id = song_dir.name
    notes_path = song_dir / "notes.json"
    if not notes_path.is_file():
        raise FileNotFoundError(f"No existe {notes_path}")

    audio_file = next((p for p in song_dir.iterdir() if p.stem == "source" and p.suffix.lower() in MEDIA_TYPES), None)
    if audio_file is None:
        raise FileNotFoundError(f"No hay source.<ext> en {song_dir}")

    data = json.loads(notes_path.read_text(encoding="utf-8"))
    ext = audio_file.suffix.lower()
    audio_storage_path = f"{song_id}/source{ext}"
    notes_storage_path = f"{song_id}/notes.json"

    _upload(client, AUDIO_BUCKET, audio_storage_path, audio_file.read_bytes(), MEDIA_TYPES[ext])
    _upload(client, NOTES_BUCKET, notes_storage_path, notes_path.read_bytes(), "application/json")

    row = {
        "id": song_id,
        "title": title or song_id,
        "filename": data.get("source", {}).get("filename", audio_file.name),
        "duration": float(data.get("duration", 0)),
        "note_count": len(data.get("notes", [])),
        "pedal_count": len(data.get("pedals", [])),
        "engine": data.get("transcription", {}).get("engine", ""),
        "audio_path": audio_storage_path,
        "notes_path": notes_storage_path,
    }
    # No pisar un titulo que ya se edito en la nube si no nos dan uno nuevo
    if title is None:
        existing = client.table("songs").select("title").eq("id", song_id).execute().data
        if existing:
            row["title"] = existing[0]["title"]

    client.table("songs").upsert(row).execute()
    return row


def unpublish_song(song_id: str, client: Client | None = None) -> None:
    client = client or get_client()
    for bucket in (AUDIO_BUCKET, NOTES_BUCKET):
        files = client.storage.from_(bucket).list(song_id)
        paths = [f"{song_id}/{f['name']}" for f in files or []]
        if paths:
            client.storage.from_(bucket).remove(paths)
    client.table("songs").delete().eq("id", song_id).execute()


def list_published(client: Client | None = None) -> list[dict]:
    client = client or get_client()
    return client.table("songs").select("id,title,duration,note_count,created_at").order("created_at", desc=True).execute().data
