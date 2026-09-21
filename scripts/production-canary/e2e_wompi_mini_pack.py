#!/usr/bin/env python3
"""Mini Pack Wompi sandbox E2E helper.

Does NOT print secrets. Exits non-zero if required env is missing (HARD STOP).

Usage (after credentials are configured in the shell / .env.local — never commit them):

  set BILLING_ENABLED=true
  set WOMPI_EXPECT_PRODUCTIVE=false
  set NEXT_PUBLIC_APP_URL=https://piano-notes-from-song.vercel.app
  # + WOMPI_CLIENT_ID / WOMPI_CLIENT_SECRET / WOMPI_APLICATIVO_ID
  python scripts/production-canary/e2e_wompi_mini_pack.py --check-config
  python scripts/production-canary/e2e_wompi_mini_pack.py --checkout --user-id <uuid> --access-token <jwt>
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load_dotenv() -> None:
    for path in (ROOT / ".env", ROOT / ".env.local"):
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip("\"'")
            if k and k not in os.environ:
                os.environ[k] = v


def _present(name: str) -> bool:
    return bool(os.environ.get(name, "").strip())


def check_config() -> int:
    required = [
        "WOMPI_CLIENT_ID",
        "WOMPI_CLIENT_SECRET",
        "WOMPI_APLICATIVO_ID",
        "NEXT_PUBLIC_APP_URL",
    ]
    missing = [n for n in required if not _present(n)]
    print("config_check")
    print("  BILLING_ENABLED=", os.environ.get("BILLING_ENABLED", "<unset>"))
    print(
        "  WOMPI_EXPECT_PRODUCTIVE=",
        os.environ.get("WOMPI_EXPECT_PRODUCTIVE", "<unset>"),
    )
    print("  NEXT_PUBLIC_APP_URL_set=", _present("NEXT_PUBLIC_APP_URL"))
    for n in ("WOMPI_CLIENT_ID", "WOMPI_CLIENT_SECRET", "WOMPI_APLICATIVO_ID"):
        print(f"  {n}_set=", _present(n))
    if missing:
        print("HARD_STOP missing:", ",".join(missing))
        print(
            "Configure secrets on Vercel project piano-notes-from-song "
            "(Production + Preview) then redeploy. Keep WOMPI_EXPECT_PRODUCTIVE=false."
        )
        return 2
    if os.environ.get("WOMPI_EXPECT_PRODUCTIVE", "").lower() == "true":
        print("HARD_STOP: WOMPI_EXPECT_PRODUCTIVE must be false for sandbox E2E")
        return 2
    if os.environ.get("BILLING_ENABLED", "").lower() != "true":
        print("NOTE: BILLING_ENABLED is not true — checkout will 503 until enabled")
        return 1
    print("config_ok")
    return 0


def checkout(base: str, token: str) -> int:
    req = urllib.request.Request(
        f"{base.rstrip('/')}/api/billing/checkout",
        data=json.dumps({"product_code": "mini_pack"}).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        print("checkout_http", exc.code, raw[:300])
        return 1
    print(
        "checkout_ok",
        {
            "purchase_id": body.get("purchase_id"),
            "product_code": body.get("product_code"),
            "url_enlace_host": (body.get("url_enlace") or "").split("/")[2:3],
        },
    )
    return 0


def main() -> int:
    _load_dotenv()
    p = argparse.ArgumentParser()
    p.add_argument("--check-config", action="store_true")
    p.add_argument("--checkout", action="store_true")
    p.add_argument("--base-url", default=os.environ.get("NEXT_PUBLIC_APP_URL", ""))
    p.add_argument("--access-token", default="")
    args = p.parse_args()
    if args.check_config or not (args.checkout):
        code = check_config()
        if not args.checkout:
            return code
        if code == 2:
            return code
    if args.checkout:
        if not args.base_url or not args.access_token:
            print("need --base-url and --access-token")
            return 2
        return checkout(args.base_url, args.access_token)
    return 0


if __name__ == "__main__":
    sys.exit(main())
