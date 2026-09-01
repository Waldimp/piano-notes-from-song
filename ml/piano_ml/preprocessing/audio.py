"""Decodificacion de audio via FFmpeg.

Convierte cualquier formato que FFmpeg entienda (.mp3, .wav, .m4a, .flac, .ogg)
a PCM float32 mono a la tasa de muestreo que pida el engine. Usamos FFmpeg
directamente (en lugar de librosa/audioread) para tener un unico camino de
decodificacion, explicito y depurable.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import numpy as np

SUPPORTED_EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac", ".ogg"}


class AudioDecodeError(RuntimeError):
    """El archivo no se pudo decodificar (corrupto, formato no soportado, etc.)."""


def ffmpeg_bin() -> str:
    return os.environ.get("FFMPEG_BIN", "ffmpeg")


def ensure_ffmpeg_available() -> None:
    if shutil.which(ffmpeg_bin()) is None:
        raise AudioDecodeError(
            f"No se encontro FFmpeg ('{ffmpeg_bin()}'). Instalalo y/o define FFMPEG_BIN."
        )


def load_audio_mono(path: str | Path, sample_rate: int) -> np.ndarray:
    """Decodifica `path` a float32 mono en [-1, 1] a `sample_rate` Hz."""
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"No existe el archivo de audio: {path}")
    if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise AudioDecodeError(
            f"Extension no soportada: '{path.suffix}'. Soportadas: "
            + ", ".join(sorted(SUPPORTED_EXTENSIONS))
        )
    ensure_ffmpeg_available()

    cmd = [
        ffmpeg_bin(),
        "-v", "error",
        "-i", str(path),
        "-f", "f32le",          # PCM float32 little-endian crudo por stdout
        "-acodec", "pcm_f32le",
        "-ac", "1",              # mono
        "-ar", str(sample_rate),
        "-",
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        stderr = proc.stderr.decode("utf-8", "replace").strip()
        raise AudioDecodeError(f"FFmpeg fallo al decodificar '{path.name}': {stderr}")

    audio = np.frombuffer(proc.stdout, dtype=np.float32)
    if audio.size == 0:
        raise AudioDecodeError(f"FFmpeg no produjo audio para '{path.name}' (archivo vacio o corrupto)")
    return audio


def audio_duration_seconds(audio: np.ndarray, sample_rate: int) -> float:
    return float(len(audio)) / float(sample_rate)
