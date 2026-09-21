"""Admin: assign beta plan/credits. Uses service role. Never expose publicly."""
from __future__ import annotations

import argparse
import json
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
    parser = argparse.ArgumentParser(description="Set account entitlement (admin/service_role)")
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--plan", required=True, choices=["free", "mini", "practice", "plus"])
    parser.add_argument("--credits", type=int, default=None)
    args = parser.parse_args()

    base = env("SUPABASE_URL").rstrip("/")
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    body = {
        "p_user_id": args.user_id,
        "p_plan_code": args.plan,
        "p_credit_balance": args.credits,
    }
    req = urllib.request.Request(
        f"{base}/rest/v1/rpc/admin_set_account_entitlement",
        data=json.dumps(body).encode(),
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read().decode()
    # Print only non-secret fields
    data = json.loads(raw) if raw else {}
    print(json.dumps({
        "user_id": data.get("user_id"),
        "plan_code": data.get("plan_code"),
        "credit_balance": data.get("credit_balance"),
    }))


if __name__ == "__main__":
    main()
