#!/usr/bin/env python
"""CPU-only cleanup for hash-verified private artifacts of completed jobs."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "worker"))

from piano_worker.controlled import get_staging_client  # noqa: E402
from piano_worker.reconciliation import cleanup_completed_staging  # noqa: E402


if __name__ == "__main__":
    print("cleaned", len(cleanup_completed_staging(get_staging_client())), "staging artifacts")
