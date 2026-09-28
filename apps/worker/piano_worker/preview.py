"""FREE preview: resolve and apply the per-request trim BEFORE transcription.

Shared by the Modal controlled runner and the legacy local worker so both
paths spend GPU only on the first `preview_seconds` of the upload.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any


def resolve_preview_seconds(value: Any) -> int | None:
    """Normalise requests.preview_seconds (None/0/garbage -> None)."""
    if value is None:
        return None
    try:
        seconds = int(value)
    except (TypeError, ValueError):
        return None
    return seconds if seconds > 0 else None


def fetch_preview_seconds(client: Any, request_id: str) -> int | None:
    """Read requests.preview_seconds with a service client; never raises."""
    try:
        res = (
            client.table("requests")
            .select("preview_seconds")
            .eq("id", request_id)
            .limit(1)
            .execute()
        )
        rows = getattr(res, "data", None) or []
        if not rows:
            return None
        return resolve_preview_seconds(rows[0].get("preview_seconds"))
    except Exception:  # noqa: BLE001 — a lookup failure must not break the job
        return None


def prepare_transcription_input(input_path: Path, preview_seconds: int | None) -> Path:
    """Return the file to transcribe: the trimmed head for previews, else the original."""
    if preview_seconds is None:
        return input_path
    from piano_ml.preprocessing.trim import preview_input_path, trim_audio_head

    target = preview_input_path(input_path, preview_seconds)
    return trim_audio_head(input_path, target, preview_seconds)
