"""Preprocesamiento: decodificacion FFmpeg -> float32 mono.

Estos tests generan audio sintetico con FFmpeg; se omiten si no esta instalado.
"""

import shutil
import subprocess

import numpy as np
import pytest

from piano_ml.preprocessing.audio import (
    AudioDecodeError,
    audio_duration_seconds,
    load_audio_mono,
)

ffmpeg_missing = shutil.which("ffmpeg") is None
pytestmark = pytest.mark.skipif(ffmpeg_missing, reason="FFmpeg no disponible")

SR = 16000


@pytest.fixture(scope="module")
def sine_wav(tmp_path_factory):
    """WAV estereo de 2 s, 44.1 kHz, tono de 440 Hz (La4)."""
    path = tmp_path_factory.mktemp("audio") / "sine.wav"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi",
         "-i", "sine=frequency=440:duration=2:sample_rate=44100",
         "-ac", "2", str(path)],
        check=True,
    )
    return path


def test_load_resamples_to_mono_16k(sine_wav):
    audio = load_audio_mono(sine_wav, SR)
    assert audio.dtype == np.float32
    assert audio.ndim == 1
    assert abs(audio_duration_seconds(audio, SR) - 2.0) < 0.05
    assert np.max(np.abs(audio)) > 0.1  # hay senal real


def test_missing_file_raises():
    with pytest.raises(FileNotFoundError):
        load_audio_mono("no/existe.wav", SR)


def test_unsupported_extension_raises(tmp_path):
    bad = tmp_path / "cancion.txt"
    bad.write_text("no soy audio")
    with pytest.raises(AudioDecodeError, match="Extension no soportada"):
        load_audio_mono(bad, SR)


def test_corrupt_audio_raises(tmp_path):
    fake = tmp_path / "corrupto.mp3"
    fake.write_bytes(b"esto no es un mp3 de verdad")
    with pytest.raises(AudioDecodeError):
        load_audio_mono(fake, SR)
