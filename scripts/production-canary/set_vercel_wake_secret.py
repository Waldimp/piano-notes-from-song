"""Add wake secret to Vercel without printing its value."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SECRET_FILE = ROOT / ".local-backups" / "production-canary-preflight" / "dispatch-wake.secret.json"
NAME = "PRODUCTION_CANARY_DISPATCH_WAKE_SECRET"


def main() -> None:
    payload = json.loads(SECRET_FILE.read_text(encoding="utf-8"))
    value = payload.get(NAME)
    if not isinstance(value, str) or len(value) < 32:
        raise SystemExit("wake secret file missing or invalid")

    targets = ["production", "preview"]
    for target in targets:
        cmd = [
            "npx", "vercel", "env", "add", NAME, target,
            "--cwd", str(ROOT),
            "--project", "piano-notes-from-song",
            "--sensitive",
            "--value", value,
            "--yes",
            "--force",
        ]
        # Do not echo command with value.
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            shell=True,
        )
        # Redact any accidental value leakage from stderr/stdout before printing.
        out = (result.stdout or "") + (result.stderr or "")
        safe = out.replace(value, "[REDACTED]")
        print(f"target={target} exit={result.returncode}")
        print(safe[-800:] if len(safe) > 800 else safe)
        if result.returncode != 0:
            sys.exit(result.returncode)
    print("wake_secret_configured")


if __name__ == "__main__":
    main()
