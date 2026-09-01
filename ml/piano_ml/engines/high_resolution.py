"""Engine: High-Resolution Piano Transcription (Kong et al., ByteDance).

Envuelve el paquete oficial `piano_transcription_inference` 0.0.6 resolviendo
tres incompatibilidades conocidas SIN modificar el paquete:

1. La auto-descarga del checkpoint usa `wget` via os.system (no existe en
   Windows). Aqui se exige un checkpoint local explicito; se descarga con
   `scripts/download_model.py`.
2. torch >= 2.6 usa `weights_only=True` por defecto en torch.load, lo que
   rechaza este checkpoint de 2020. Se carga dentro de un contexto que
   restablece `weights_only=False` SOLO para este checkpoint de origen
   conocido (Zenodo record 4034264).
3. El audio se decodifica con FFmpeg (piano_ml.preprocessing) en lugar del
   camino librosa/audioread del paquete.
"""

from __future__ import annotations

import os
import time
from contextlib import contextmanager
from pathlib import Path

from .base import EngineError, RawTranscription, TranscriptionEngine

ENGINE_NAME = "high-resolution-piano-transcription"
CHECKPOINT_FILENAME = "note_F1=0.9677_pedal_F1=0.9186.pth"
# Tamano esperado del checkpoint (~165 MB); el paquete valida >= 1.6e8 bytes.
MIN_CHECKPOINT_BYTES = 160_000_000


def default_checkpoint_path() -> Path:
    env = os.environ.get("PIANO_CHECKPOINT_PATH")
    if env:
        return Path(env)
    # ml/checkpoints/ relativo a este archivo: ml/piano_ml/engines/ -> ml/
    return Path(__file__).resolve().parents[2] / "checkpoints" / CHECKPOINT_FILENAME


def resolve_device(requested: str | None = None) -> str:
    """'auto' (o None) -> cuda si esta disponible, si no cpu."""
    import torch

    requested = requested or os.environ.get("PIANO_DEVICE", "auto")
    if requested == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    return requested


@contextmanager
def _legacy_torch_load():
    """torch.load con weights_only=False, solo durante la carga del checkpoint."""
    import torch

    original = torch.load

    def patched(*args, **kwargs):
        kwargs.setdefault("weights_only", False)
        return original(*args, **kwargs)

    torch.load = patched
    try:
        yield
    finally:
        torch.load = original


class HighResolutionEngine(TranscriptionEngine):
    name = ENGINE_NAME

    def __init__(self, checkpoint_path: str | Path | None = None, device: str | None = None):
        self.checkpoint_path = Path(checkpoint_path) if checkpoint_path else default_checkpoint_path()
        self.device = resolve_device(device)
        self._transcriptor = None  # carga perezosa; reutilizable entre llamadas
        self.model_load_seconds: float | None = None

    def _ensure_model(self):
        if self._transcriptor is not None:
            return self._transcriptor

        if not self.checkpoint_path.is_file() or self.checkpoint_path.stat().st_size < MIN_CHECKPOINT_BYTES:
            raise EngineError(
                f"Checkpoint no encontrado o incompleto: {self.checkpoint_path}\n"
                "Descargalo con: python scripts/download_model.py"
            )

        from piano_transcription_inference import PianoTranscription

        t0 = time.perf_counter()
        with _legacy_torch_load():
            self._transcriptor = PianoTranscription(
                device=self.device, checkpoint_path=str(self.checkpoint_path)
            )
        self.model_load_seconds = time.perf_counter() - t0
        return self._transcriptor

    def transcribe(self, audio_path: str | Path) -> RawTranscription:
        from piano_transcription_inference import sample_rate

        from ..preprocessing.audio import audio_duration_seconds, load_audio_mono

        audio = load_audio_mono(audio_path, sample_rate)
        duration = audio_duration_seconds(audio, sample_rate)

        transcriptor = self._ensure_model()
        try:
            result = transcriptor.transcribe(audio, midi_path=None)
        except Exception as exc:  # noqa: BLE001 — el modelo puede fallar de muchas formas
            raise EngineError(f"Fallo de inferencia del modelo: {exc}") from exc

        return RawTranscription(
            engine=self.name,
            duration=duration,
            note_events=result.get("est_note_events", []) or [],
            pedal_events=result.get("est_pedal_events", []) or [],
        )
