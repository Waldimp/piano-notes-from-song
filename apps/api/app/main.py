"""Backend local de desarrollo (Fase 1).

Endpoints sincronos: aceptable para el prototipo segun el contrato (seccion 15).
Si la transcripcion resulta demasiado lenta para un request normal, se
refactorizara a un modelo de jobs asincrono — no antes de medir.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from piano_ml.engines.base import EngineError
from piano_ml.engines.high_resolution import HighResolutionEngine
from piano_ml.pipeline import transcribe_file
from piano_ml.preprocessing.audio import SUPPORTED_EXTENSIONS, AudioDecodeError

from . import library
from .jobs import JobStore, run_transcription_job

logger = logging.getLogger("piano.api")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

REPO_ROOT = Path(__file__).resolve().parents[3]
INPUT_DIR = REPO_ROOT / "data" / "input"
OUTPUT_DIR = REPO_ROOT / "data" / "output"

app = FastAPI(title="Piano Tutorial API", version="0.1.0")

# Local-first: se acepta cualquier puerto de localhost (Next elige otro
# puerto si el 3000 esta ocupado).
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)

# Un solo engine por proceso: el modelo se carga una vez y se reutiliza.
_engine = HighResolutionEngine()
_jobs = JobStore()

library.ensure_schema()


def _safe_stem(name: str) -> str:
    """Nombre de carpeta seguro derivado del nombre de archivo subido."""
    stem = Path(name).stem
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._")
    return stem or "audio"


# Un id valido es lo que produce _safe_stem: solo estos caracteres, sin
# empezar por punto y sin ".." (nada de path traversal). No se puede
# re-aplicar _safe_stem al id porque Path.stem cortaria en un punto
# interior del nombre (p. ej. "Y2Mate.is_...").
_ID_RE = re.compile(r"[A-Za-z0-9_-][A-Za-z0-9._-]*")


def _is_safe_id(transcription_id: str) -> bool:
    return bool(_ID_RE.fullmatch(transcription_id)) and ".." not in transcription_id


def _cloud_configured() -> bool:
    try:
        from piano_worker.cloud import is_configured

        return is_configured()
    except ImportError:
        return False


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "engine": _engine.name,
        "device": _engine.device,
        "cloud": _cloud_configured(),
    }


@app.post("/api/transcribe")
async def transcribe(file: UploadFile) -> dict:
    """Version sincrona (util para curl/scripts). El navegador usa /api/jobs."""
    audio_path = _save_upload(file)
    audio_path.write_bytes(await file.read())
    stem = audio_path.stem

    try:
        result = transcribe_file(audio_path, engine=_engine, output_root=OUTPUT_DIR)
    except (AudioDecodeError, EngineError) as exc:
        logger.error("Transcripcion fallida: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    library.upsert_song(stem, result.notes_path)

    return {
        "id": stem,
        "stats": {
            "audioDuration": result.audio_duration,
            "processingSeconds": result.processing_seconds,
            "noteCount": len(result.transcription.notes),
            "pedalCount": len(result.transcription.pedals),
            "engine": result.engine,
        },
        "transcription": result.transcription.model_dump(),
    }


def _save_upload(file: UploadFile) -> Path:
    """Valida y guarda el upload en data/input; devuelve la ruta local."""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=f"Formato no soportado '{suffix}'. Soportados: {sorted(SUPPORTED_EXTENSIONS)}",
        )
    stem = _safe_stem(file.filename or "audio")
    INPUT_DIR.mkdir(parents=True, exist_ok=True)
    return INPUT_DIR / f"{stem}{suffix}"


@app.post("/api/jobs", status_code=202)
async def create_job(file: UploadFile, background: BackgroundTasks) -> dict:
    """Sube un audio y encola su transcripcion; devuelve el id del job."""
    audio_path = _save_upload(file)
    audio_path.write_bytes(await file.read())

    job = _jobs.create(filename=audio_path.name)
    background.add_task(run_transcription_job, _jobs, job, audio_path, OUTPUT_DIR, _engine)
    logger.info("Job %s encolado para %s", job.id, audio_path.name)
    return {"jobId": job.id}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job no encontrado")
    data = job.to_public()
    if job.status in ("queued", "processing"):
        data["queuePosition"] = _jobs.queue_position(job_id)
    return data


@app.get("/api/transcriptions")
def list_transcriptions() -> list[dict]:
    """Lista la biblioteca con metadata (backfillea transcripciones del CLI)."""
    return library.list_songs(OUTPUT_DIR)


class RenamePayload(BaseModel):
    title: str


@app.patch("/api/transcriptions/{transcription_id}")
def rename_transcription(transcription_id: str, payload: RenamePayload) -> dict:
    _output_dir_for(transcription_id)  # valida id y existencia
    if not library.rename_song(transcription_id, payload.title):
        raise HTTPException(status_code=400, detail="Titulo vacio o cancion no registrada")
    return {"id": transcription_id, "title": payload.title.strip()}


class PublishPayload(BaseModel):
    title: str | None = None


@app.post("/api/transcriptions/{transcription_id}/publish")
def publish_transcription(transcription_id: str, payload: PublishPayload | None = None) -> dict:
    """Sube la cancion a Supabase para verla desde cualquier dispositivo."""
    out_dir = _output_dir_for(transcription_id)
    if not _cloud_configured():
        raise HTTPException(status_code=503, detail="Supabase no configurado en .env de esta PC")
    from piano_worker.cloud import publish_song

    try:
        row = publish_song(out_dir, title=(payload.title if payload else None))
    except Exception as exc:  # noqa: BLE001 — error de red/credenciales al usuario
        logger.exception("Publicacion fallida")
        raise HTTPException(status_code=502, detail=f"Supabase rechazo la publicacion: {exc}") from exc
    return {"id": row["id"], "title": row["title"], "published": True}


@app.delete("/api/transcriptions/{transcription_id}")
def delete_transcription(transcription_id: str) -> Response:
    _output_dir_for(transcription_id)  # valida id y existencia
    library.delete_song(transcription_id, OUTPUT_DIR)
    return Response(status_code=204)


def _output_dir_for(transcription_id: str) -> Path:
    if not _is_safe_id(transcription_id):
        raise HTTPException(status_code=400, detail="Identificador invalido")
    d = OUTPUT_DIR / transcription_id
    if not d.is_dir():
        raise HTTPException(status_code=404, detail="Transcripcion no encontrada")
    return d


@app.get("/api/transcriptions/{transcription_id}/notes")
def get_notes(transcription_id: str) -> FileResponse:
    path = _output_dir_for(transcription_id) / "notes.json"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="notes.json no encontrado")
    return FileResponse(path, media_type="application/json")


@app.get("/api/transcriptions/{transcription_id}/midi")
def get_midi(transcription_id: str) -> FileResponse:
    path = _output_dir_for(transcription_id) / "transcription.mid"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="MIDI no encontrado")
    return FileResponse(path, media_type="audio/midi", filename=f"{transcription_id}.mid")


MEDIA_TYPES = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
}


@app.get("/api/transcriptions/{transcription_id}/audio")
def get_audio(transcription_id: str) -> FileResponse:
    out_dir = _output_dir_for(transcription_id)
    for ext, media_type in MEDIA_TYPES.items():
        path = out_dir / f"source{ext}"
        if path.is_file():
            return FileResponse(path, media_type=media_type)
    raise HTTPException(status_code=404, detail="Audio original no encontrado")
