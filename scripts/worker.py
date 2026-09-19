#!/usr/bin/env python
"""Levanta el worker de solicitudes (ver apps/worker/piano_worker/worker.py)."""

from __future__ import annotations

import argparse
import json
import logging
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="Procesa la cola de solicitudes de Supabase con la GPU local")
    parser.add_argument("--once", action="store_true", help="Procesa lo pendiente y termina")
    parser.add_argument("--interval", type=float, default=15.0, help="Segundos entre revisiones (default 15)")
    parser.add_argument(
        "--staging-receipt", metavar="JSON",
        help="Procesa un único recibo controlado de staging; no hace polling",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    if args.staging_receipt:
        from piano_ml.engines.high_resolution import HighResolutionEngine
        from piano_worker.controlled import DispatchReceipt, get_staging_client
        from piano_worker.controlled_runner import process_dispatch

        receipt = DispatchReceipt.from_payload(json.loads(args.staging_receipt))
        result = process_dispatch(
            get_staging_client(), HighResolutionEngine(), receipt, "local"
        )
        print(json.dumps(result, indent=2))
        return 0

    from piano_worker.worker import run

    return run(once=args.once, interval=args.interval)


if __name__ == "__main__":
    sys.exit(main())
