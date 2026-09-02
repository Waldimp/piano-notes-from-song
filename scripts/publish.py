#!/usr/bin/env python
"""Publica transcripciones locales en Supabase para verlas desde cualquier dispositivo.

Uso:
    python scripts/publish.py cut_liszt                    # publica data/output/cut_liszt
    python scripts/publish.py cut_liszt --title "Liszt"    # con titulo
    python scripts/publish.py --list                       # que hay publicado
    python scripts/publish.py --unpublish cut_liszt        # quitar de la nube
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("song_id", nargs="?", help="Carpeta en data/output/")
    parser.add_argument("--title", default=None)
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--unpublish", metavar="SONG_ID")
    args = parser.parse_args()

    from piano_worker.cloud import list_published, publish_song, unpublish_song

    if args.list:
        for row in list_published():
            print(f"{row['id']:<40} {row['title']:<30} {row['duration']:>6.0f}s {row['note_count']:>6} notas")
        return 0
    if args.unpublish:
        unpublish_song(args.unpublish)
        print(f"Quitada de la nube: {args.unpublish}")
        return 0
    if not args.song_id:
        parser.error("indica un song_id, --list o --unpublish")

    row = publish_song(REPO_ROOT / "data" / "output" / args.song_id, title=args.title)
    print(f"Publicada: {row['id']} — '{row['title']}' ({row['note_count']} notas)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
