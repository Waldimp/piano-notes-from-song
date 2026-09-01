"""Exportacion MIDI opcional (debugging / pruebas de escucha).

Reutiliza el escritor del paquete oficial para producir MIDIs identicos a los
del pipeline original (mismo formato que el dataset MAESTRO).
"""

from __future__ import annotations

from pathlib import Path

from .contracts import PianoTranscription


def write_midi(transcription: PianoTranscription, midi_path: str | Path) -> None:
    from piano_transcription_inference.utilities import write_events_to_midi

    note_events = [
        {
            "midi_note": n.pitch,
            "onset_time": n.start,
            "offset_time": n.end,
            "velocity": n.velocity,
        }
        for n in transcription.notes
    ]
    pedal_events = [
        {"onset_time": p.start, "offset_time": p.end} for p in transcription.pedals
    ]
    Path(midi_path).parent.mkdir(parents=True, exist_ok=True)
    write_events_to_midi(
        start_time=0,
        note_events=note_events,
        pedal_events=pedal_events,
        midi_path=str(midi_path),
    )
