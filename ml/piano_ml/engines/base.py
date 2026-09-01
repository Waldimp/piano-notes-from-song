"""Abstraccion minima de engine de transcripcion (AMT).

Cada engine produce una RawTranscription con eventos en un formato comun
"crudo" (dicts estilo piano_transcription_inference). La capa de
normalizacion (piano_ml.normalize) convierte eso al contrato validado.

El frontend y el API nunca dependen de un engine concreto.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class RawTranscription:
    """Salida cruda de un engine, antes de normalizar.

    note_events: dicts con claves midi_note, onset_time, offset_time, velocity.
    pedal_events: dicts con claves onset_time, offset_time.
    """

    engine: str
    duration: float
    note_events: list[dict[str, Any]] = field(default_factory=list)
    pedal_events: list[dict[str, Any]] = field(default_factory=list)


class TranscriptionEngine(ABC):
    """Un engine AMT intercambiable (High-Resolution hoy, Basic Pitch manana)."""

    name: str

    @abstractmethod
    def transcribe(self, audio_path: str | Path) -> RawTranscription:
        """Transcribe un archivo de audio local a eventos crudos."""


class EngineError(RuntimeError):
    """Fallo de inferencia o de configuracion del engine."""
