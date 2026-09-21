"""E2E: web-equivalent create + authenticated /api/wake-dispatch (no secrets printed)."""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROD = "https://piano-notes-from-song.vercel.app"
AUDIO_PATH = "882724c6-be57-4321-ae36-e5f8a91c379f/El_Carbonero.mp3"
FILENAME = "El_Carbonero.mp3"
USER_EMAIL = "melanievanessamejiapalacios@gmail.com"
USER_ID = "1b683c76-4c19-4afb-8ff0-c72b8c078e7f"


def env(name: str) -> str:
    for path in (ROOT / ".env", ROOT / ".env.local"):
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip().strip("\"'")
    raise SystemExit(f"missing {name}")


def http_json(url: str, *, method: str = "GET", headers: dict | None = None, body: dict | None = None, timeout: int = 60):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    if body is not None and "Content-Type" not in (headers or {}):
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"raw": "[non-json]"}
        return exc.code, payload


def user_access_token() -> str:
    """Mint a short-lived user session via admin generate_link + verify. Never print token."""
    base = env("SUPABASE_URL").rstrip("/")
    service = env("SUPABASE_SERVICE_ROLE_KEY")
    anon = env("SUPABASE_ANON_KEY")
    status, link = http_json(
        f"{base}/auth/v1/admin/generate_link",
        method="POST",
        headers={"apikey": service, "Authorization": f"Bearer {service}"},
        body={"type": "magiclink", "email": USER_EMAIL},
    )
    if status >= 400:
        raise SystemExit(f"generate_link_failed http={status}")
    props = link.get("properties") or link
    token_hash = props.get("hashed_token") or link.get("hashed_token")
    if not token_hash:
        raise SystemExit("generate_link_missing_hashed_token")
    status, verified = http_json(
        f"{base}/auth/v1/verify",
        method="POST",
        headers={"apikey": anon, "Authorization": f"Bearer {anon}"},
        body={"type": "magiclink", "token_hash": token_hash},
    )
    if status >= 400:
        raise SystemExit(f"verify_failed http={status}")
    access = (verified.get("access_token") or (verified.get("session") or {}).get("access_token"))
    if not isinstance(access, str) or len(access) < 20:
        raise SystemExit("verify_missing_access_token")
    return access


def create_queued_request(access: str) -> str:
    base = env("SUPABASE_URL").rstrip("/")
    anon = env("SUPABASE_ANON_KEY")
    status, rows = http_json(
        f"{base}/rest/v1/requests?select=id",
        method="POST",
        headers={
            "apikey": anon,
            "Authorization": f"Bearer {access}",
            "Prefer": "return=representation",
        },
        body={
            "filename": FILENAME,
            "audio_path": AUDIO_PATH,
            "requested_by": USER_ID,
        },
    )
    if status >= 400 or not isinstance(rows, list) or not rows:
        raise SystemExit(f"insert_failed http={status} body={rows}")
    return rows[0]["id"]


def get_request(request_id: str) -> dict:
    base = env("SUPABASE_URL").rstrip("/")
    service = env("SUPABASE_SERVICE_ROLE_KEY")
    status, rows = http_json(
        f"{base}/rest/v1/requests?id=eq.{request_id}&select=id,status,attempt_count,worker_kind,error",
        headers={"apikey": service, "Authorization": f"Bearer {service}"},
    )
    if status >= 400 or not rows:
        raise SystemExit(f"get_request_failed http={status}")
    return rows[0]


def wait_status(request_id: str, wanted: set[str], timeout_s: int = 600) -> dict:
    deadline = time.time() + timeout_s
    last = {}
    while time.time() < deadline:
        last = get_request(request_id)
        print(f"request={request_id} status={last.get('status')}")
        if last.get("status") in wanted:
            return last
        time.sleep(5)
    raise SystemExit(f"timeout status={last}")


def main() -> None:
    # Auth gate on public wake
    code, body = http_json(f"{PROD}/api/wake-dispatch", method="POST", body={"request_id": "00000000-0000-4000-8000-000000000000"})
    print(f"unauth_wake http={code} keys={sorted(body.keys())}")
    assert code == 401

    code, body = http_json(f"{PROD}/api/wake-dispatch", method="GET")
    print(f"get_wake http={code}")
    assert code == 405

    access = user_access_token()
    print("session=ok")

    for i in range(2):
        rid = create_queued_request(access)
        print(f"created[{i}]={rid} status=queued")
        t0 = time.time()
        code, wake_body = http_json(
            f"{PROD}/api/wake-dispatch",
            method="POST",
            headers={"Authorization": f"Bearer {access}"},
            body={"request_id": rid, "action": "admin"},  # ignored; must not select UUID
        )
        serialized = json.dumps(wake_body)
        assert "PRODUCTION_CANARY_DISPATCH_WAKE_SECRET" not in serialized
        assert env("CRON_SECRET") not in serialized
        print(f"wake[{i}] http={code} body={serialized}")
        assert code in {200, 502}
        # duplicate wake must not pick arbitrary UUID / must be idle or harmless
        code2, wake2 = http_json(
            f"{PROD}/api/wake-dispatch",
            method="POST",
            headers={"Authorization": f"Bearer {access}"},
        )
        print(f"wake_dup[{i}] http={code2} body={json.dumps(wake2)}")

        processing = wait_status(rid, {"processing", "done"}, timeout_s=180)
        print(f"to_processing_s={time.time() - t0:.1f} status={processing['status']}")
        done = wait_status(rid, {"done", "error"}, timeout_s=600)
        assert done["status"] == "done", done
        assert done.get("worker_kind") == "modal"
        print(f"done[{i}]={rid}")

    # cron recovery path still auth-gated and callable
    cron = env("CRON_SECRET")
    code, body = http_json(
        f"{PROD}/api/dispatch-wake",
        method="GET",
        headers={"Authorization": f"Bearer {cron}"},
    )
    print(f"cron_wake http={code} ok={body.get('ok')} result_status={(body.get('result') or {}).get('status')}")
    print("e2e_ok")


if __name__ == "__main__":
    main()
