"""Recorte de audio ANTES de la transcripcion (preview FREE).

`trim_audio_head` copia solo los primeros N segundos del archivo a otro
archivo del mismo formato, sin re-codificar cuando es posible. FFmpeg deja de
decodificar al llegar a `-t`, asi que una cancion de 10 minutos no cuesta mas
que una de 60 s ni en CPU ni en GPU.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from .audio import AudioDecodeError, ensure_ffmpeg_available, ffmpeg_bin

# Formatos que admiten stream copy con -t sin problemas de contenedor.
_COPY_SAFE_SUFFIXES = {".mp3", ".wav", ".flac"}


def trim_audio_head(source: str | Path, target: str | Path, seconds: float) -> Path:
    """Escribe en `target` los primeros `seconds` segundos de `source`."""
    source = Path(source)
    target = Path(target)
    if seconds <= 0:
        raise ValueError("seconds must be positive")
    if not source.is_file():
        raise FileNotFoundError(f"No existe el audio a recortar: {source}")
    ensure_ffmpeg_available()

    if source.suffix.lower() in _COPY_SAFE_SUFFIXES and source.suffix.lower() == target.suffix.lower():
        codec = ["-c", "copy"]
    else:
        codec = []  # re-codificar con el codec por defecto del contenedor destino
    cmd = [
        ffmpeg_bin(), "-v", "error", "-y",
        "-i", str(source),
        "-t", f"{seconds:.3f}",
        "-vn", "-map_metadata", "-1",
        *codec,
        str(target),
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0 or not target.is_file() or target.stat().st_size == 0:
        raise AudioDecodeError(
            f"FFmpeg no pudo recortar '{source.name}': {proc.stderr.decode('utf-8', 'replace').strip()}"
        )
    return target


def preview_input_path(original: str | Path, seconds: int) -> Path:
    """Ruta hermana determinista para el recorte: input.mp3 -> input.preview60.mp3."""
    original = Path(original)
    return original.with_name(f"{original.stem}.preview{int(seconds)}{original.suffix}")
