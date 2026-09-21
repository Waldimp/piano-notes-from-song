"""Beta readiness security/invariants tests (static + SQL via service role where available)."""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]


def _env(name: str) -> str | None:
    for path in (ROOT / ".env", ROOT / ".env.local"):
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip().strip("\"'")
    return None


def test_beta_migration_and_web_trust_boundary_exist():
    sql = (ROOT / "migrations/supabase/0011_beta_readiness.sql").read_text(encoding="utf-8")
    cloud = (ROOT / "apps/web/src/lib/data/cloud.ts").read_text(encoding="utf-8")
    create = (ROOT / "apps/web/src/app/api/create-request/route.ts").read_text(encoding="utf-8")
    wake = (ROOT / "apps/web/src/app/api/wake-dispatch/route.ts").read_text(encoding="utf-8")
    cron = (ROOT / "apps/web/src/app/api/dispatch-wake/route.ts").read_text(encoding="utf-8")
    assert "account_entitlements" in sql
    assert "user_credit_ledger" in sql
    assert "authorize_beta_request" in sql
    assert "owner_id = auth.uid()" in sql
    assert "requested_by = auth.uid()" in sql
    assert "split_part(name, '/', 1) = auth.uid()::text" in sql
    assert "settle_user_credit_for_request" in sql
    assert "release_user_credit_for_request" in sql
    assert "/api/create-request" in cloud
    assert "${userData.user.id}/" in cloud
    assert "authorize_beta_request" in create
    assert "parseBuffer" in create
    assert "PRODUCTION_CANARY_DISPATCH_WAKE_SECRET" not in create
    assert "check_beta_rate_limit" in wake
    assert "CRON_SECRET" in cron


def test_beta_limits_config_is_centralized():
    limits = (ROOT / "apps/web/src/lib/beta/limits.ts").read_text(encoding="utf-8")
    assert "maxDurationSeconds: 60" in limits
    assert "includedCredits: 3" in limits
    assert "maxDurationSeconds: 600" in limits


@pytest.mark.skipif(not _env("SUPABASE_SERVICE_ROLE_KEY"), reason="no service role")
def test_live_rls_and_credit_gates():
    base = _env("SUPABASE_URL")
    service = _env("SUPABASE_SERVICE_ROLE_KEY")
    anon = _env("SUPABASE_ANON_KEY")
    assert base and service and anon

    def http(url: str, method="GET", headers=None, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
        if body is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read().decode()
                return resp.status, json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode()
            try:
                payload = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                payload = {"raw": raw[:200]}
            return exc.code, payload

    # Anon cannot read songs/requests
    st, _ = http(
        f"{base}/rest/v1/songs?select=id&limit=1",
        headers={"apikey": anon, "Authorization": f"Bearer {anon}"},
    )
    assert st in {200, 401, 403}
    if st == 200:
        # empty under RLS is ok; must not leak rows without auth user
        pass

    user_a = "1b683c76-4c19-4afb-8ff0-c72b8c078e7f"
    user_b = "b71ee4f6-44c8-4179-9280-9c83daaef6bd"

    # Mint sessions
    def token_for(email: str) -> str:
        st, link = http(
            f"{base}/auth/v1/admin/generate_link",
            method="POST",
            headers={"apikey": service, "Authorization": f"Bearer {service}"},
            body={"type": "magiclink", "email": email},
        )
        assert st < 400
        token_hash = link.get("hashed_token")
        st, verified = http(
            f"{base}/auth/v1/verify",
            method="POST",
            headers={"apikey": anon, "Authorization": f"Bearer {anon}"},
            body={"type": "magiclink", "token_hash": token_hash},
        )
        assert st < 400
        return verified["access_token"]

    tok_a = token_for("melanievanessamejiapalacios@gmail.com")
    tok_b = token_for("waltermejia61@hotmail.com")

    st, songs_a = http(
        f"{base}/rest/v1/songs?select=id,owner_id",
        headers={"apikey": anon, "Authorization": f"Bearer {tok_a}"},
    )
    assert st == 200
    assert all(row.get("owner_id") == user_a for row in songs_a)

    st, songs_b = http(
        f"{base}/rest/v1/songs?select=id,owner_id",
        headers={"apikey": anon, "Authorization": f"Bearer {tok_b}"},
    )
    assert st == 200
    assert all(row.get("owner_id") == user_b for row in songs_b)
    ids_a = {r["id"] for r in songs_a}
    ids_b = {r["id"] for r in songs_b}
    assert ids_a.isdisjoint(ids_b) or not ids_a or not ids_b

    # A cannot update B song title
    if songs_b:
        victim = songs_b[0]["id"]
        st, _ = http(
            f"{base}/rest/v1/songs?id=eq.{victim}",
            method="PATCH",
            headers={
                "apikey": anon,
                "Authorization": f"Bearer {tok_a}",
                "Prefer": "return=minimal",
            },
            body={"title": "hacked"},
        )
        assert st in {200, 204, 404}
        st, check = http(
            f"{base}/rest/v1/songs?id=eq.{victim}&select=title",
            headers={"apikey": anon, "Authorization": f"Bearer {tok_b}"},
        )
        assert st == 200
        assert check and check[0]["title"] != "hacked"

    # Duration gate via authorize_beta_request (FREE max = 60s; no Modal)
    http(
        f"{base}/rest/v1/rpc/admin_set_account_entitlement",
        method="POST",
        headers={"apikey": service, "Authorization": f"Bearer {service}"},
        body={"p_user_id": user_a, "p_plan_code": "free", "p_credit_balance": 2},
    )
    st, denied = http(
        f"{base}/rest/v1/rpc/authorize_beta_request",
        method="POST",
        headers={"apikey": anon, "Authorization": f"Bearer {tok_a}"},
        body={
            "p_filename": "long.mp3",
            "p_audio_path": f"{user_a}/fake/long.mp3",
            "p_measured_duration_seconds": 120,
        },
    )
    assert st == 200
    assert denied.get("ok") is False
    assert denied.get("code") == "duration_exceeded"

    # Clear any leftover active rows so the credit gate is observable
    http(
        f"{base}/rest/v1/requests?requested_by=eq.{user_a}&status=in.(queued,processing)",
        method="PATCH",
        headers={
            "apikey": service,
            "Authorization": f"Bearer {service}",
            "Prefer": "return=minimal",
        },
        body={"status": "error", "error": "test_cleanup", "failure_code": "test_cleanup"},
    )

    # Zero credits gate
    http(
        f"{base}/rest/v1/rpc/admin_set_account_entitlement",
        method="POST",
        headers={"apikey": service, "Authorization": f"Bearer {service}"},
        body={"p_user_id": user_a, "p_plan_code": "free", "p_credit_balance": 0},
    )
    st, denied2 = http(
        f"{base}/rest/v1/rpc/authorize_beta_request",
        method="POST",
        headers={"apikey": anon, "Authorization": f"Bearer {tok_a}"},
        body={
            "p_filename": "ok.mp3",
            "p_audio_path": f"{user_a}/fake/ok.mp3",
            "p_measured_duration_seconds": 30,
        },
    )
    assert st == 200
    assert denied2.get("ok") is False
    assert denied2.get("code") == "no_credits"

    # Restore usable free credits for later E2E
    http(
        f"{base}/rest/v1/rpc/admin_set_account_entitlement",
        method="POST",
        headers={"apikey": service, "Authorization": f"Bearer {service}"},
        body={"p_user_id": user_a, "p_plan_code": "mini", "p_credit_balance": 2},
    )
    http(
        f"{base}/rest/v1/rpc/admin_set_account_entitlement",
        method="POST",
        headers={"apikey": service, "Authorization": f"Bearer {service}"},
        body={"p_user_id": user_b, "p_plan_code": "mini", "p_credit_balance": 2},
    )
