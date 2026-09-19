#!/usr/bin/env python
"""Apply or roll back migration 0002 only against a confirmed staging DB."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
UP = ROOT / "migrations" / "supabase" / "0002_modal_worker_controlled_staging.sql"
DOWN = ROOT / "migrations" / "supabase" / "0002_modal_worker_controlled_staging.down.sql"


def _validated_url() -> str:
    if os.environ.get("PIANO_ENVIRONMENT") != "staging":
        raise SystemExit("Refused: PIANO_ENVIRONMENT must be staging")
    url = os.environ.get("STAGING_SUPABASE_DB_URL", "")
    raw_manifest = os.environ.get("STAGING_IDENTITY_MANIFEST", "")
    digest = os.environ.get("STAGING_IDENTITY_SHA256", "").lower()
    if not url or not raw_manifest or len(digest) != 64:
        raise SystemExit("Refused: explicit staging identity is required")
    try:
        manifest = json.loads(raw_manifest)
        canonical = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    except (TypeError, json.JSONDecodeError) as exc:
        raise SystemExit("Refused: staging identity manifest is invalid") from exc
    if hashlib.sha256(canonical).hexdigest() != digest:
        raise SystemExit("Refused: staging identity fingerprint mismatch")
    project_ref = manifest.get("project_ref")
    if (manifest.get("environment") != "staging" or manifest.get("modal_environment") != "staging"
            or manifest.get("storage_namespace") != "_staging"
            or manifest.get("database_project_ref") != project_ref
            or manifest.get("database_url") != url
            or os.environ.get("CONFIRM_STAGING_PROJECT_REF") != project_ref):
        raise SystemExit("Refused: staging DB is not manifest-bound and explicitly confirmed")
    allowlist_path = ROOT / "scripts" / "staging" / "identity-allowlist.json"
    try:
        allowlist = json.loads(allowlist_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit("Refused: staging identity allowlist is unavailable") from exc
    fields = ("environment", "supabase_url", "project_ref", "modal_environment",
              "storage_namespace", "modal_dispatch_url", "database_url",
              "database_project_ref")
    if allowlist.get("version") != 1 or not any(
        isinstance(entry, dict) and all(entry.get(key) == manifest.get(key) for key in fields)
        for entry in allowlist.get("entries", [])
    ):
        raise SystemExit("Refused: staging identity is not in the reviewed allowlist")
    if any(name in os.environ for name in ("DATABASE_URL", "SUPABASE_DB_URL", "SUPABASE_URL")):
        raise SystemExit("Refused: generic or production database variables must be absent")
    return url


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("check", "up", "down"))
    args = parser.parse_args()
    for path in (UP, DOWN):
        raw = path.read_bytes()
        print(f"{path.name}: sha256={hashlib.sha256(raw).hexdigest()} bytes={len(raw)}")
    if args.action == "check":
        return 0
    url = _validated_url()
    try:
        import psycopg
    except ImportError as exc:
        raise SystemExit("Install scripts/staging/requirements.txt first") from exc
    sql = (UP if args.action == "up" else DOWN).read_text(encoding="utf-8")
    with psycopg.connect(url) as connection:
        connection.execute(sql)
    print(f"Migration {args.action} completed on the manifest-confirmed staging project")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
