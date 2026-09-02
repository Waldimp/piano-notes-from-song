"""Worker de solicitudes: procesa la cola de Supabase con la GPU local.

Se levanta a mano (no es un servicio permanente):
    python scripts/worker.py            # procesa lo pendiente y sigue escuchando (Ctrl+C para salir)
    python scripts/worker.py --once     # procesa lo pendiente y termina

Flujo por solicitud:
    queued -> processing -> [descargar audio] -> transcribir -> publicar -> done
                                                      -> error (con mensaje)
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from pathlib import Path

from .cloud import REPO_ROOT, UPLOADS_BUCKET, get_client, publish_song, slugify

logger = logging.getLogger("piano.worker")

INPUT_DIR = REPO_ROOT / "data" / "input"
OUTPUT_DIR = REPO_ROOT / "data" / "output"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fetch_next(client) -> dict | None:
    rows = (
        client.table("requests")
        .select("*")
        .eq("status", "queued")
        .order("created_at")
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None


def _unique_stem(stem: str) -> str:
    """Evita pisar una cancion existente con el mismo nombre de archivo."""
    candidate, n = stem, 2
    while (OUTPUT_DIR / candidate).exists():
        candidate = f"{stem}_{n}"
        n += 1
    return candidate


def process_request(client, req: dict, engine) -> None:
    from piano_ml.pipeline import transcribe_file

    req_id = req["id"]
    client.table("requests").update({"status": "processing", "started_at": _now()}).eq("id", req_id).execute()
    logger.info("Solicitud %s: %s", req_id, req["filename"])

    try:
        ext = Path(req["filename"]).suffix.lower() or ".mp3"
        stem = _unique_stem(slugify(req["filename"]))
        INPUT_DIR.mkdir(parents=True, exist_ok=True)
        audio_path = INPUT_DIR / f"{stem}{ext}"
        audio_path.write_bytes(client.storage.from_(UPLOADS_BUCKET).download(req["audio_path"]))

        result = transcribe_file(audio_path, engine=engine, output_root=OUTPUT_DIR)
        # Registrar tambien en la biblioteca local para que aparezca en tu PC
        try:
            import sys

            sys.path.insert(0, str(REPO_ROOT / "apps" / "api"))
            from app import library  # type: ignore[import-not-found]

            library.ensure_schema()
            library.upsert_song(stem, result.notes_path)
        except Exception as exc:  # noqa: BLE001 — la biblioteca local es secundaria aqui
            logger.warning("No se registro en la biblioteca local: %s", exc)

        title = Path(req["filename"]).stem
        publish_song(result.notes_path.parent, title=title, client=client)

        client.table("requests").update(
            {"status": "done", "song_id": stem, "finished_at": _now()}
        ).eq("id", req_id).execute()
        # El audio original ya vive en el bucket "audio"; limpiamos el upload
        client.storage.from_(UPLOADS_BUCKET).remove([req["audio_path"]])
        logger.info("Solicitud %s publicada como '%s' (%d notas)", req_id, stem, len(result.transcription.notes))
    except Exception as exc:  # noqa: BLE001 — el estado de la solicitud ES el manejo
        logger.exception("Solicitud %s fallo", req_id)
        client.table("requests").update(
            {"status": "error", "error": str(exc)[:500], "finished_at": _now()}
        ).eq("id", req_id).execute()


def run(once: bool = False, interval: float = 15.0) -> int:
    from piano_ml.engines.high_resolution import HighResolutionEngine

    client = get_client()
    engine = HighResolutionEngine()
    logger.info("Worker listo (dispositivo: %s). %s", engine.device,
                "Procesando pendientes y saliendo." if once else f"Revisando cada {interval:.0f}s; Ctrl+C para salir.")

    processed = 0
    try:
        while True:
            req = _fetch_next(client)
            if req is not None:
                process_request(client, req, engine)
                processed += 1
                continue  # puede haber mas en cola
            if once:
                break
            time.sleep(interval)
    except KeyboardInterrupt:
        logger.info("Worker detenido.")
    logger.info("Solicitudes procesadas: %d", processed)
    return 0
