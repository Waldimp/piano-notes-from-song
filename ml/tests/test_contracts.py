"""Validacion del contrato: valores imposibles deben rechazarse."""

import pytest
from pydantic import ValidationError

from piano_ml.contracts import (
    PedalEvent,
    PianoNote,
    PianoTranscription,
    SourceInfo,
    TranscriptionInfo,
)


def make_note(**overrides):
    base = dict(pitch=60, start=1.0, end=1.5, velocity=80, hand=None)
    base.update(overrides)
    return PianoNote(**base)


class TestPianoNote:
    def test_valid_note(self):
        note = make_note()
        assert note.pitch == 60
        assert note.hand is None

    @pytest.mark.parametrize("pitch", [20, 109, -1, 200])
    def test_pitch_outside_piano_range_rejected(self, pitch):
        with pytest.raises(ValidationError):
            make_note(pitch=pitch)

    @pytest.mark.parametrize("pitch", [21, 108])
    def test_pitch_at_piano_bounds_accepted(self, pitch):
        assert make_note(pitch=pitch).pitch == pitch

    def test_end_before_start_rejected(self):
        with pytest.raises(ValidationError):
            make_note(start=2.0, end=1.0)

    def test_end_equal_start_rejected(self):
        with pytest.raises(ValidationError):
            make_note(start=2.0, end=2.0)

    def test_negative_start_rejected(self):
        with pytest.raises(ValidationError):
            make_note(start=-0.1, end=1.0)

    @pytest.mark.parametrize("velocity", [-1, 128])
    def test_invalid_velocity_rejected(self, velocity):
        with pytest.raises(ValidationError):
            make_note(velocity=velocity)

    def test_invalid_hand_rejected(self):
        with pytest.raises(ValidationError):
            make_note(hand="both")

    @pytest.mark.parametrize("hand", ["left", "right", None])
    def test_valid_hands(self, hand):
        assert make_note(hand=hand).hand == hand


class TestPedalEvent:
    def test_valid(self):
        assert PedalEvent(start=0.0, end=1.0).end == 1.0

    def test_end_before_start_rejected(self):
        with pytest.raises(ValidationError):
            PedalEvent(start=2.0, end=1.0)

    def test_negative_start_rejected(self):
        with pytest.raises(ValidationError):
            PedalEvent(start=-1.0, end=1.0)


class TestPianoTranscription:
    def test_valid_roundtrip(self):
        t = PianoTranscription(
            version=1,
            duration=10.0,
            source=SourceInfo(filename="song.mp3"),
            transcription=TranscriptionInfo(engine="high-resolution-piano-transcription"),
            notes=[make_note()],
            pedals=[PedalEvent(start=0.5, end=2.0)],
        )
        data = t.model_dump()
        assert data["version"] == 1
        assert data["notes"][0]["hand"] is None
        # El JSON debe poder re-validarse (ida y vuelta estable)
        assert PianoTranscription.model_validate(data) == t

    def test_wrong_version_rejected(self):
        with pytest.raises(ValidationError):
            PianoTranscription(
                version=2,
                duration=10.0,
                source=SourceInfo(filename="x.mp3"),
                transcription=TranscriptionInfo(engine="e"),
                notes=[],
                pedals=[],
            )

    def test_zero_duration_rejected(self):
        with pytest.raises(ValidationError):
            PianoTranscription(
                version=1,
                duration=0,
                source=SourceInfo(filename="x.mp3"),
                transcription=TranscriptionInfo(engine="e"),
                notes=[],
                pedals=[],
            )
