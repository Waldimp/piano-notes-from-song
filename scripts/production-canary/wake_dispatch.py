"""Generate/store wake secret and wake the general Modal dispatcher.

Never prints secret values. Uses SUPABASE_ACCESS_TOKEN from .env.local and
writes the wake secret only to the protected local secrets file (gitignored).
"""
from __future__ import annotations

import json
import secrets
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LOCAL_SECRETS = ROOT / ".local-backups" / "production-canary-preflight" / "dispatch-wake.secret.json"
PROJECT_REF = "epapmenfnyfqdfmsgfee"
FUNCTION = "dispatch-modal-staging"


def _token() -> str:
    for line in (ROOT / ".env.local").read_text(encoding="utf-8").splitlines():
        if line.startswith("SUPABASE_ACCESS_TOKEN="):
            return line.split("=", 1)[1].strip().strip("\"'")
    raise SystemExit("SUPABASE_ACCESS_TOKEN missing")


def _supabase_url() -> str:
    for path in (ROOT / ".env", ROOT / ".env.local"):
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("SUPABASE_URL=") or line.startswith("NEXT_PUBLIC_SUPABASE_URL="):
                return line.split("=", 1)[1].strip().strip("\"'")
    return f"https://{PROJECT_REF}.supabase.co"


def ensure_wake_secret() -> str:
    LOCAL_SECRETS.parent.mkdir(parents=True, exist_ok=True)
    if LOCAL_SECRETS.exists():
        payload = json.loads(LOCAL_SECRETS.read_text(encoding="utf-8"))
        secret = payload.get("PRODUCTION_CANARY_DISPATCH_WAKE_SECRET")
        if isinstance(secret, str) and len(secret) >= 32:
            return secret
    secret = secrets.token_urlsafe(32)
    LOCAL_SECRETS.write_text(
        json.dumps({"PRODUCTION_CANARY_DISPATCH_WAKE_SECRET": secret}, indent=2) + "\n",
        encoding="utf-8",
    )
    token = _token()
    body = json.dumps([{"name": "PRODUCTION_CANARY_DISPATCH_WAKE_SECRET", "value": secret}]).encode()
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/secrets",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req) as response:
        response.read()
    return secret


def wake_once(secret: str | None = None) -> tuple[int, str]:
    secret = secret or ensure_wake_secret()
    endpoint = f"{_supabase_url().rstrip('/')}/functions/v1/{FUNCTION}"
    body = json.dumps({"action": "dispatch_next"}).encode()
    req = urllib.request.Request(
        endpoint,
        data=body,
        headers={
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as response:
            return response.status, response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--ensure-secret", action="store_true")
    parser.add_argument("--wake", action="store_true")
    args = parser.parse_args()
    if args.ensure_secret or not args.wake:
        ensure_wake_secret()
        print("wake_secret_ready")
    if args.wake:
        status, body = wake_once()
        print(f"status={status}")
        # Body may contain request/dispatch ids; that is fine and non-secret.
        print(body)


if __name__ == "__main__":
    main()
