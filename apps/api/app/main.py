"""Backend local de desarrollo (Fase 1).

Endpoints sincronos: aceptable para el prototipo segun el contrato (seccion 15).
Si la transcripcion resulta demasiado lenta para un request normal, se
refactorizara a un modelo de jobs asincrono — no antes de medir.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from piano_ml.engines.base import EngineError
from piano_ml.engines.high_resolution import HighResolutionEngine
from piano_ml.pipeline import transcribe_file
from piano_ml.preprocessing.audio import SUPPORTED_EXTENSIONS, AudioDecodeError

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


def _safe_stem(name: str) -> str:
    """Nombre de carpeta seguro derivado del nombre de archivo subido."""
    stem = Path(name).stem
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._")
    return stem or "audio"


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "engine": _engine.name, "device": _engine.device}


@app.post("/api/transcribe")
async def transcribe(file: UploadFile) -> dict:
    """Sube un audio, lo transcribe y devuelve la transcripcion normalizada."""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=f"Formato no soportado '{suffix}'. Soportados: {sorted(SUPPORTED_EXTENSIONS)}",
        )

    stem = _safe_stem(file.filename or "audio")
    INPUT_DIR.mkdir(parents=True, exist_ok=True)
    audio_path = INPUT_DIR / f"{stem}{suffix}"
    audio_path.write_bytes(await file.read())

    try:
        result = transcribe_file(audio_path, engine=_engine, output_root=OUTPUT_DIR)
    except (AudioDecodeError, EngineError) as exc:
        logger.error("Transcripcion fallida: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc)) from exc

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


@app.get("/api/transcriptions")
def list_transcriptions() -> list[dict]:
    """Lista las transcripciones ya generadas en data/output/."""
    items = []
    if OUTPUT_DIR.is_dir():
        for d in sorted(OUTPUT_DIR.iterdir()):
            if (d / "notes.json").is_file():
                items.append({"id": d.name})
    return items


def _output_dir_for(transcription_id: str) -> Path:
    if transcription_id != _safe_stem(transcription_id):
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
