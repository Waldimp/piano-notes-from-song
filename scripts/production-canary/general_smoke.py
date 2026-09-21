"""Controlled smoke for general Modal dispatch. Does not print secrets."""
from __future__ import annotations

import json
import time
import uuid
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _env(name: str) -> str:
    for path in (ROOT / ".env", ROOT / ".env.local"):
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip().strip("\"'")
    raise SystemExit(f"missing {name}")


def _sb():
    from supabase import create_client
    return create_client(_env("SUPABASE_URL"), _env("SUPABASE_SERVICE_ROLE_KEY"))


def create_queued_request(audio_path: str, filename: str, requested_by: str) -> str:
    client = _sb()
    row = {
        "filename": filename,
        "audio_path": audio_path,
        "requested_by": requested_by,
    }
    data = client.table("requests").insert(row).execute().data
    return data[0]["id"]


def wait_done(request_id: str, timeout_s: int = 600) -> dict:
    client = _sb()
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        rows = client.table("requests").select(
            "id,status,song_id,error,attempt_count,worker_kind"
        ).eq("id", request_id).execute().data
        row = rows[0]
        if row["status"] in {"done", "error"}:
            return row
        time.sleep(5)
    raise TimeoutError(f"request {request_id} did not finish")


def validate_done(request_id: str) -> dict:
    client = _sb()
    req = client.table("requests").select("id,status,song_id,worker_kind,attempt_count").eq(
        "id", request_id
    ).single().execute().data
    songs = client.table("songs").select(
        "id,duration,note_count,pedal_count,audio_path,notes_path"
    ).eq("request_id", request_id).execute().data
    return {
        "request": req,
        "songs": songs,
    }


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--create", action="store_true")
    parser.add_argument("--audio-path", default="882724c6-be57-4321-ae36-e5f8a91c379f/El_Carbonero.mp3")
    parser.add_argument("--filename", default="El_Carbonero.mp3")
    parser.add_argument("--requested-by", default="1b683c76-4c19-4afb-8ff0-c72b8c078e7f")
    parser.add_argument("--wait", dest="request_id")
    parser.add_argument("--validate", dest="validate_id")
    args = parser.parse_args()
    if args.create:
        rid = create_queued_request(args.audio_path, args.filename, args.requested_by)
        print(json.dumps({"request_id": rid}))
    if args.request_id:
        print(json.dumps(wait_done(args.request_id)))
    if args.validate_id:
        print(json.dumps(validate_done(args.validate_id), default=str))
