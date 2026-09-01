#!/usr/bin/env python
"""CLI de Fase 1: transcribe un archivo de audio de piano.

Uso:
    python scripts/transcribe.py data/input/song.mp3
    python scripts/transcribe.py data/input/song.mp3 --device cpu --no-midi

Salida:
    data/output/<song>/notes.json
    data/output/<song>/transcription.mid
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcribe audio de piano a notes.json (+ MIDI)")
    parser.add_argument("audio", help="Ruta al archivo de audio (.wav .mp3 .m4a .flac .ogg)")
    parser.add_argument("--device", default=None, choices=["auto", "cuda", "cpu"],
                        help="Dispositivo de inferencia (default: PIANO_DEVICE o auto)")
    parser.add_argument("--checkpoint", default=None, help="Ruta al checkpoint .pth")
    parser.add_argument("--output", default=str(REPO_ROOT / "data" / "output"),
                        help="Directorio raiz de salida")
    parser.add_argument("--no-midi", action="store_true", help="No generar transcription.mid")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    from piano_ml.engines.base import EngineError
    from piano_ml.engines.high_resolution import HighResolutionEngine
    from piano_ml.pipeline import transcribe_file
    from piano_ml.preprocessing.audio import AudioDecodeError

    engine = HighResolutionEngine(checkpoint_path=args.checkpoint, device=args.device)
    logging.info("Dispositivo        : %s", engine.device)

    try:
        transcribe_file(
            args.audio,
            engine=engine,
            output_root=args.output,
            write_midi_file=not args.no_midi,
        )
    except (FileNotFoundError, AudioDecodeError, EngineError) as exc:
        logging.error("%s", exc)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
