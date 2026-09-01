#!/usr/bin/env python
"""Recalcula la asignacion de manos de transcripciones ya generadas.

Uso:
    python scripts/assign_hands.py               # todas las de data/output
    python scripts/assign_hands.py cut_liszt     # solo una
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = REPO_ROOT / "data" / "output"


def main() -> int:
    from piano_ml.contracts import PianoTranscription
    from piano_ml.hands import assign_hands

    ids = sys.argv[1:] or [d.name for d in sorted(OUTPUT_DIR.iterdir())
                           if (d / "notes.json").is_file()]
    for song_id in ids:
        notes_path = OUTPUT_DIR / song_id / "notes.json"
        if not notes_path.is_file():
            print(f"[omitido] {song_id}: sin notes.json", file=sys.stderr)
            continue
        t = PianoTranscription.model_validate_json(notes_path.read_text(encoding="utf-8"))
        t = assign_hands(t)
        notes_path.write_text(json.dumps(t.model_dump(), indent=2), encoding="utf-8")
        left = sum(1 for n in t.notes if n.hand == "left")
        print(f"{song_id}: {left} izquierda / {len(t.notes) - left} derecha")
    return 0


if __name__ == "__main__":
    sys.exit(main())
