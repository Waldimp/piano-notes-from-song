"""Normalizacion: eventos crudos del engine -> contrato PianoTranscription (v1).

Reglas:
- pitch fuera de 21..108 se descarta (imposible en un piano de 88 teclas).
- eventos con end <= start o start < 0 se descartan.
- velocity se redondea y recorta a 0..127.
- las notas se ordenan por (start, pitch); los pedales por start.
- hand = None hasta que exista post-procesamiento de manos.

Los eventos descartados se reportan para no ocultar problemas del modelo.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from .contracts import (
    MAX_PIANO_PITCH,
    MIN_PIANO_PITCH,
    PedalEvent,
    PianoNote,
    PianoTranscription,
    SourceInfo,
    TranscriptionInfo,
)
from .engines.base import RawTranscription

logger = logging.getLogger(__name__)


@dataclass
class NormalizationReport:
    kept_notes: int = 0
    kept_pedals: int = 0
    dropped: list[str] = field(default_factory=list)


def _clamp_velocity(value: Any) -> int:
    return max(0, min(127, round(float(value))))


def normalize_raw(
    raw: RawTranscription,
    filename: str,
    report: NormalizationReport | None = None,
) -> PianoTranscription:
    """Convierte una RawTranscription en el contrato validado."""
    report = report if report is not None else NormalizationReport()

    notes: list[PianoNote] = []
    for ev in raw.note_events:
        try:
            pitch = int(ev["midi_note"])
            start = float(ev["onset_time"])
            end = float(ev["offset_time"])
        except (KeyError, TypeError, ValueError) as exc:
            report.dropped.append(f"nota malformada {ev!r}: {exc}")
            continue

        if not MIN_PIANO_PITCH <= pitch <= MAX_PIANO_PITCH:
            report.dropped.append(f"pitch fuera de rango de piano: {pitch}")
            continue
        if start < 0 or end <= start:
            report.dropped.append(f"tiempos invalidos: start={start} end={end} pitch={pitch}")
            continue

        notes.append(
            PianoNote(
                pitch=pitch,
                start=start,
                end=end,
                velocity=_clamp_velocity(ev.get("velocity", 0)),
                hand=None,
            )
        )

    pedals: list[PedalEvent] = []
    for ev in raw.pedal_events:
        try:
            start = float(ev["onset_time"])
            end = float(ev["offset_time"])
        except (KeyError, TypeError, ValueError) as exc:
            report.dropped.append(f"pedal malformado {ev!r}: {exc}")
            continue
        if start < 0 or end <= start:
            report.dropped.append(f"pedal con tiempos invalidos: start={start} end={end}")
            continue
        pedals.append(PedalEvent(start=start, end=end))

    notes.sort(key=lambda n: (n.start, n.pitch))
    pedals.sort(key=lambda p: p.start)

    report.kept_notes = len(notes)
    report.kept_pedals = len(pedals)
    for msg in report.dropped:
        logger.warning("Evento descartado: %s", msg)

    return PianoTranscription(
        version=1,
        duration=raw.duration,
        source=SourceInfo(filename=filename),
        transcription=TranscriptionInfo(engine=raw.engine),
        notes=notes,
        pedals=pedals,
    )
