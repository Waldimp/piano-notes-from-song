#!/usr/bin/env python
"""Descarga el checkpoint de High-Resolution Piano Transcription (~165 MB).

Origen: Zenodo record 4034264 (checkpoint oficial del paper de Kong et al.).
Destino: ml/checkpoints/note_F1=0.9677_pedal_F1=0.9186.pth
(La auto-descarga del paquete usa `wget`, que no existe en Windows; por eso
este script gestiona el checkpoint de forma explicita.)
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
CHECKPOINT_URL = (
    "https://zenodo.org/record/4034264/files/"
    "CRNN_note_F1%3D0.9677_pedal_F1%3D0.9186.pth?download=1"
)
DEST = REPO_ROOT / "ml" / "checkpoints" / "note_F1=0.9677_pedal_F1=0.9186.pth"
MIN_BYTES = 160_000_000


def main() -> int:
    if DEST.is_file() and DEST.stat().st_size >= MIN_BYTES:
        print(f"Checkpoint ya presente: {DEST} ({DEST.stat().st_size / 1e6:.0f} MB)")
        return 0

    DEST.parent.mkdir(parents=True, exist_ok=True)
    tmp = DEST.with_suffix(".pth.part")
    print(f"Descargando checkpoint (~165 MB) desde Zenodo...\n  -> {DEST}")

    def report(blocks: int, block_size: int, total: int) -> None:
        done = blocks * block_size
        if total > 0:
            pct = min(100.0, done * 100.0 / total)
            print(f"\r  {done / 1e6:7.1f} MB / {total / 1e6:.1f} MB ({pct:5.1f}%)", end="")

    try:
        urllib.request.urlretrieve(CHECKPOINT_URL, tmp, reporthook=report)
        print()
    except Exception as exc:  # noqa: BLE001
        print(f"\nError de descarga: {exc}", file=sys.stderr)
        return 1

    if tmp.stat().st_size < MIN_BYTES:
        print(f"Descarga incompleta ({tmp.stat().st_size} bytes); se elimina.", file=sys.stderr)
        tmp.unlink(missing_ok=True)
        return 1

    tmp.replace(DEST)
    print(f"Listo: {DEST} ({DEST.stat().st_size / 1e6:.0f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
