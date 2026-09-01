"""Normalizacion: eventos crudos del engine -> contrato limpio."""

from piano_ml.engines.base import RawTranscription
from piano_ml.normalize import NormalizationReport, normalize_raw


def raw(notes=None, pedals=None, duration=10.0):
    return RawTranscription(
        engine="test-engine",
        duration=duration,
        note_events=notes or [],
        pedal_events=pedals or [],
    )


def note_event(midi_note=60, onset=1.0, offset=1.5, velocity=80):
    return {
        "midi_note": midi_note,
        "onset_time": onset,
        "offset_time": offset,
        "velocity": velocity,
    }


class TestNormalizeNotes:
    def test_valid_note_kept(self):
        t = normalize_raw(raw(notes=[note_event()]), filename="a.mp3")
        assert len(t.notes) == 1
        assert t.notes[0].pitch == 60
        assert t.notes[0].hand is None
        assert t.source.filename == "a.mp3"
        assert t.transcription.engine == "test-engine"

    def test_pitch_out_of_piano_range_dropped(self):
        report = NormalizationReport()
        t = normalize_raw(
            raw(notes=[note_event(midi_note=20), note_event(midi_note=109), note_event()]),
            filename="a.mp3",
            report=report,
        )
        assert len(t.notes) == 1
        assert len(report.dropped) == 2

    def test_end_before_start_dropped(self):
        t = normalize_raw(raw(notes=[note_event(onset=2.0, offset=1.0)]), filename="a.mp3")
        assert t.notes == []

    def test_negative_onset_dropped(self):
        t = normalize_raw(raw(notes=[note_event(onset=-0.5, offset=1.0)]), filename="a.mp3")
        assert t.notes == []

    def test_velocity_clamped(self):
        t = normalize_raw(
            raw(notes=[note_event(velocity=300), note_event(velocity=-5)]),
            filename="a.mp3",
        )
        assert [n.velocity for n in t.notes] == [127, 0]

    def test_velocity_rounded(self):
        t = normalize_raw(raw(notes=[note_event(velocity=80.6)]), filename="a.mp3")
        assert t.notes[0].velocity == 81

    def test_malformed_event_dropped_not_fatal(self):
        report = NormalizationReport()
        t = normalize_raw(
            raw(notes=[{"midi_note": "x"}, note_event()]),
            filename="a.mp3",
            report=report,
        )
        assert len(t.notes) == 1
        assert len(report.dropped) == 1

    def test_notes_sorted_by_start_then_pitch(self):
        t = normalize_raw(
            raw(notes=[
                note_event(midi_note=72, onset=2.0, offset=2.5),
                note_event(midi_note=60, onset=1.0, offset=1.5),
                note_event(midi_note=48, onset=2.0, offset=2.5),
            ]),
            filename="a.mp3",
        )
        assert [(n.start, n.pitch) for n in t.notes] == [(1.0, 60), (2.0, 48), (2.0, 72)]


class TestNormalizePedals:
    def test_valid_pedal_kept(self):
        t = normalize_raw(
            raw(pedals=[{"onset_time": 0.5, "offset_time": 2.0}]), filename="a.mp3"
        )
        assert len(t.pedals) == 1

    def test_invalid_pedal_dropped(self):
        t = normalize_raw(
            raw(pedals=[{"onset_time": 3.0, "offset_time": 1.0}]), filename="a.mp3"
        )
        assert t.pedals == []

    def test_pedals_sorted(self):
        t = normalize_raw(
            raw(pedals=[
                {"onset_time": 5.0, "offset_time": 6.0},
                {"onset_time": 1.0, "offset_time": 2.0},
            ]),
            filename="a.mp3",
        )
        assert [p.start for p in t.pedals] == [1.0, 5.0]
