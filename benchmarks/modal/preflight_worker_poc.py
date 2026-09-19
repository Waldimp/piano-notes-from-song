"""Preflight de sólo lectura para un único request UUID del POC."""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "apps" / "worker"))

from piano_worker.cloud import get_client, slugify  # noqa: E402


def canonical_request_id(value: str) -> str:
    parsed = uuid.UUID(value)
    canonical = str(parsed)
    if value.lower() != canonical:
        raise ValueError("request_id debe ser un UUID canónico explícito")
    return canonical


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request-id", required=True)
    args = parser.parse_args()
    request_id = canonical_request_id(args.request_id)
    client = get_client()

    rows = (
        client.table("requests")
        .select("id,filename,status,song_id")
        .eq("id", request_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        print(json.dumps({"ready": False, "reason": "request_not_found"}))
        return 2

    request = rows[0]
    candidate = (
        f"{slugify(request['filename'])}_modal_poc_"
        f"{uuid.UUID(request_id).hex[:8]}"
    )
    collision = bool(
        client.table("songs").select("id").eq("id", candidate).limit(1).execute().data
    )
    result = {
        "ready": request["status"] == "queued" and not collision,
        "request_id": request_id,
        "status": request["status"],
        "existing_request_song_id": request.get("song_id"),
        "poc_song_id": candidate,
        "poc_song_collision": collision,
    }
    print(json.dumps(result, indent=2))
    return 0 if result["ready"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
