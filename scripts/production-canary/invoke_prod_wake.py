"""Invoke production /api/dispatch-wake without printing secrets."""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def env(name: str) -> str:
    for path in (ROOT / ".env", ROOT / ".env.local"):
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip().strip("\"'")
    raise SystemExit(f"missing {name}")


def main() -> None:
    url = sys.argv[1] if len(sys.argv) > 1 else "https://piano-notes-from-song.vercel.app/api/dispatch-wake"
    secret = env("CRON_SECRET")
    req = urllib.request.Request(
        url,
        method="GET",
        headers={"Authorization": f"Bearer {secret}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            body = response.read().decode("utf-8", errors="replace")
            print(f"http={response.status}")
            print(body)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"http={exc.code}")
        print(body)
        sys.exit(1)


if __name__ == "__main__":
    main()
