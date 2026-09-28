"""FREE preview: the worker trims before transcription and never on paid requests."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from piano_worker.preview import (
    fetch_preview_seconds,
    prepare_transcription_input,
    resolve_preview_seconds,
)


class _Exec:
    def __init__(self, rows, fail=False):
        self.data = rows
        self._fail = fail

    def execute(self):
        if self._fail:
            raise RuntimeError("network down")
        return self


class _Query(_Exec):
    def select(self, *_):
        return self

    def eq(self, *_):
        return self

    def limit(self, *_):
        return self


class FakeClient:
    def __init__(self, rows, fail=False):
        self._rows = rows
        self._fail = fail

    def table(self, name):
        assert name == "requests"
        return _Query(self._rows, self._fail)


@pytest.mark.parametrize(
    "raw,expected",
    [(None, None), (0, None), (-5, None), ("60", 60), (60, 60), ("abc", None), (600, 600)],
)
def test_resolve_preview_seconds(raw, expected):
    assert resolve_preview_seconds(raw) == expected


def test_fetch_preview_seconds_reads_request_row():
    assert fetch_preview_seconds(FakeClient([{"preview_seconds": 60}]), "req") == 60


def test_fetch_preview_seconds_full_song_is_none():
    assert fetch_preview_seconds(FakeClient([{"preview_seconds": None}]), "req") is None
    assert fetch_preview_seconds(FakeClient([]), "req") is None


def test_fetch_preview_seconds_never_raises():
    assert fetch_preview_seconds(FakeClient([], fail=True), "req") is None


def test_prepare_input_full_song_untouched(tmp_path):
    src = tmp_path / "input.mp3"
    src.write_bytes(b"x")
    assert prepare_transcription_input(src, None) == src


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="FFmpeg no disponible")
def test_prepare_input_preview_trims_before_transcription(tmp_path):
    src = tmp_path / "input.wav"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi",
         "-i", "sine=frequency=440:duration=6:sample_rate=16000", str(src)],
        check=True,
    )
    out = prepare_transcription_input(src, 2)
    assert out != src and out.exists()
    assert out.name == "input.preview2.wav"
    # el recorte pesa claramente menos que el original de 6 s
    assert out.stat().st_size < src.stat().st_size * 0.5
