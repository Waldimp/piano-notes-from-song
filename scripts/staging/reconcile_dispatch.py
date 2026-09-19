#!/usr/bin/env python
"""Run CPU-only dispatch reconciliation from explicit Modal observations.

The JSON input must be produced by an independently authenticated Modal
inspector.  Missing or timed-out observations are intentionally not treated
as ``not_found``.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "worker"))
from piano_worker.controlled import get_staging_client
from piano_worker.reconciliation import reconcile_candidates


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--observations", required=True, help="JSON object keyed by dispatch_id")
    args = parser.parse_args()
    envelope = json.loads(args.observations)
    if not isinstance(envelope, dict) or not isinstance(envelope.get("observations"), dict):
        raise SystemExit("observations must be a signed envelope")
    timestamp = envelope.get("timestamp")
    signature = envelope.get("signature", "")
    observations = envelope["observations"]
    if not isinstance(timestamp, int) or abs(time.time() - timestamp) > 300:
        raise SystemExit("observation timestamp is stale")
    secret = os.environ.get("STAGING_RECONCILER_SHARED_SECRET")
    if not secret or not isinstance(signature, str):
        raise SystemExit("reconciler authentication is missing")
    canonical = json.dumps(observations, sort_keys=True, separators=(",", ":"))
    expected = hmac.new(secret.encode(), f"{timestamp}.{canonical}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise SystemExit("observation signature is invalid")

    def observe(candidate: dict) -> dict | None:
        value = observations.get(candidate["dispatch_id"])
        return value if isinstance(value, dict) else None

    print(json.dumps(reconcile_candidates(get_staging_client(), observe), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
