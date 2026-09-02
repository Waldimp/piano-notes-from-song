#!/usr/bin/env python
"""Levanta el worker de solicitudes (ver apps/worker/piano_worker/worker.py)."""

from __future__ import annotations

import argparse
import logging
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="Procesa la cola de solicitudes de Supabase con la GPU local")
    parser.add_argument("--once", action="store_true", help="Procesa lo pendiente y termina")
    parser.add_argument("--interval", type=float, default=15.0, help="Segundos entre revisiones (default 15)")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    from piano_worker.worker import run

    return run(once=args.once, interval=args.interval)


if __name__ == "__main__":
    sys.exit(main())
