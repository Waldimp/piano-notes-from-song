"""Recorte de preview: solo los primeros N segundos llegan a la transcripcion."""

import shutil
import subprocess

import pytest

from piano_ml.preprocessing.audio import audio_duration_seconds, load_audio_mono
from piano_ml.preprocessing.trim import preview_input_path, trim_audio_head

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="FFmpeg no disponible")

SR = 16000


@pytest.fixture(scope="module")
def long_wav(tmp_path_factory):
    path = tmp_path_factory.mktemp("trim") / "long.wav"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi",
         "-i", "sine=frequency=440:duration=8:sample_rate=44100", str(path)],
        check=True,
    )
    return path


def test_trim_keeps_only_head(long_wav, tmp_path):
    out = trim_audio_head(long_wav, tmp_path / "head.wav", 3)
    audio = load_audio_mono(out, SR)
    assert abs(audio_duration_seconds(audio, SR) - 3.0) < 0.15  # stream copy corta en limite de paquete


def test_trim_shorter_than_limit_is_unchanged_length(long_wav, tmp_path):
    out = trim_audio_head(long_wav, tmp_path / "same.wav", 60)
    audio = load_audio_mono(out, SR)
    assert abs(audio_duration_seconds(audio, SR) - 8.0) < 0.05


def test_trim_rejects_non_positive_seconds(long_wav, tmp_path):
    with pytest.raises(ValueError):
        trim_audio_head(long_wav, tmp_path / "x.wav", 0)


def test_trim_missing_source(tmp_path):
    with pytest.raises(FileNotFoundError):
        trim_audio_head(tmp_path / "nope.mp3", tmp_path / "x.mp3", 10)


def test_preview_input_path_is_sibling_with_marker(tmp_path):
    p = preview_input_path(tmp_path / "input.mp3", 60)
    assert p.parent == tmp_path
    assert p.name == "input.preview60.mp3"
