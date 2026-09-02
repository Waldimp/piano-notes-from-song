"""Audio de reproduccion para el navegador: AAC en contenedor MP4 (.m4a).

Por que: el MP3 (sobre todo VBR y con caratula incrustada) no tiene tabla de
posiciones fiable, asi que el navegador ESTIMA a que byte saltar al hacer
seek o al reajustar el flujo tras un cambio de velocidad; el audio suena en
un punto distinto del que reporta currentTime y el tutorial queda
desincronizado. MP4 lleva tabla de muestras exacta: saltos precisos en todos
los navegadores (incluido Safari/iPhone, donde AAC es nativo).

La transcripcion sigue usando el archivo original; esto solo cambia lo que
se reproduce.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from .audio import AudioDecodeError, ensure_ffmpeg_available, ffmpeg_bin

PLAYBACK_NAME = "playback.m4a"
PLAYBACK_MEDIA_TYPE = "audio/mp4"
_SOURCE_EXTS = (".wav", ".mp3", ".m4a", ".flac", ".ogg")


def find_source_audio(song_dir: Path) -> Path | None:
    for ext in _SOURCE_EXTS:
        p = song_dir / f"source{ext}"
        if p.is_file():
            return p
    return None


def make_playback_file(source: Path, target: Path) -> Path:
    """Transcodifica `source` a AAC 160 kbps en .m4a con moov al inicio."""
    ensure_ffmpeg_available()
    tmp = target.with_suffix(".tmp.m4a")
    cmd = [
        ffmpeg_bin(), "-v", "error", "-y",
        "-i", str(source),
        "-vn",                         # sin caratulas/imagenes incrustadas
        "-map_metadata", "-1",         # sin metadatos que desplacen el inicio
        "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart",     # indice al inicio: reproducible mientras descarga
        str(tmp),
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        tmp.unlink(missing_ok=True)
        raise AudioDecodeError(
            f"FFmpeg no pudo generar el audio de reproduccion: {proc.stderr.decode('utf-8', 'replace').strip()}"
        )
    tmp.replace(target)
    return target


def ensure_playback_file(song_dir: Path) -> Path | None:
    """Devuelve data/output/<id>/playback.m4a, generandolo si falta.

    None si la carpeta no tiene audio original del que partir.
    """
    target = song_dir / PLAYBACK_NAME
    if target.is_file() and target.stat().st_size > 0:
        return target
    source = find_source_audio(song_dir)
    if source is None:
        return None
    return make_playback_file(source, target)
