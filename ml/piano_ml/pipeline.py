"""Pipeline de Fase 1: audio local -> notes.json (+ MIDI opcional).

Orquesta preprocesamiento, engine, normalizacion y escritura de salidas.
Lo usan tanto el CLI (scripts/transcribe.py) como el backend FastAPI.
"""

from __future__ import annotations

import json
import logging
import shutil
import time
from dataclasses import dataclass
from pathlib import Path

from .contracts import PianoTranscription
from .engines.base import TranscriptionEngine
from .hands import assign_hands
from .midi import write_midi
from .normalize import NormalizationReport, normalize_raw
from .preprocessing.playback import ensure_playback_file

logger = logging.getLogger(__name__)


@dataclass
class PipelineResult:
    transcription: PianoTranscription
    notes_path: Path
    midi_path: Path | None
    audio_duration: float
    processing_seconds: float
    model_load_seconds: float | None
    engine: str
    dropped_events: int


def transcribe_file(
    audio_path: str | Path,
    engine: TranscriptionEngine,
    output_root: str | Path = "data/output",
    write_midi_file: bool = True,
    infer_hands: bool = True,
) -> PipelineResult:
    """Transcribe `audio_path` y escribe data/output/<nombre>/notes.json (+ .mid)."""
    audio_path = Path(audio_path)
    t0 = time.perf_counter()

    raw = engine.transcribe(audio_path)

    report = NormalizationReport()
    transcription = normalize_raw(raw, filename=audio_path.name, report=report)
    if infer_hands:
        transcription = assign_hands(transcription)

    out_dir = Path(output_root) / audio_path.stem
    out_dir.mkdir(parents=True, exist_ok=True)

    notes_path = out_dir / "notes.json"
    notes_path.write_text(
        json.dumps(transcription.model_dump(), indent=2), encoding="utf-8"
    )

    midi_path: Path | None = None
    if write_midi_file:
        midi_path = out_dir / "transcription.mid"
        write_midi(transcription, midi_path)

    # Copia del audio original para que la carpeta del tutorial sea autocontenida
    # (la Fase 2 reproduce el audio original junto a notes.json).
    audio_copy = out_dir / f"source{audio_path.suffix.lower()}"
    if audio_copy.resolve() != audio_path.resolve():
        shutil.copy2(audio_path, audio_copy)
    # Audio de reproduccion con saltos exactos (AAC/MP4) para el navegador.
    try:
        ensure_playback_file(out_dir)
    except Exception as exc:  # noqa: BLE001 — sin el m4a se reproduce el original
        logger.warning("No se genero playback.m4a: %s", exc)

    elapsed = time.perf_counter() - t0
    model_load = getattr(engine, "model_load_seconds", None)

    result = PipelineResult(
        transcription=transcription,
        notes_path=notes_path,
        midi_path=midi_path,
        audio_duration=raw.duration,
        processing_seconds=elapsed,
        model_load_seconds=model_load,
        engine=raw.engine,
        dropped_events=len(report.dropped),
    )

    logger.info("Duracion del audio : %.2f s", result.audio_duration)
    logger.info("Engine             : %s", result.engine)
    if model_load is not None:
        logger.info("Carga del modelo   : %.2f s", model_load)
    logger.info("Tiempo de proceso  : %.2f s", result.processing_seconds)
    logger.info("Notas detectadas   : %d", len(transcription.notes))
    logger.info("Pedales detectados : %d", len(transcription.pedals))
    if result.dropped_events:
        logger.warning("Eventos descartados: %d", result.dropped_events)
    logger.info("notes.json         : %s", notes_path)
    if midi_path:
        logger.info("MIDI               : %s", midi_path)

    return result
