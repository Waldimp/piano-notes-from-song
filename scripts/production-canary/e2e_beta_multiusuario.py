"""E2E beta: two users isolated; one successful Modal job each (mini plan)."""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROD = "https://piano-notes-from-song.vercel.app"
AUDIO = "882724c6-be57-4321-ae36-e5f8a91c379f/El_Carbonero.mp3"  # legacy path for copy source
FILENAME = "El_Carbonero.mp3"

USERS = [
    {
        "email": "melanievanessamejiapalacios@gmail.com",
        "id": "1b683c76-4c19-4afb-8ff0-c72b8c078e7f",
        "label": "A",
    },
    {
        "email": "waltermejia61@hotmail.com",
        "id": "b71ee4f6-44c8-4179-9280-9c83daaef6bd",
        "label": "B",
    },
]


def env(name: str) -> str:
    for path in (ROOT / ".env", ROOT / ".env.local"):
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip().strip("\"'")
    raise SystemExit(f"missing {name}")


def http(url: str, method="GET", headers=None, body=None, raw: bytes | None = None, timeout=120):
    data = raw if raw is not None else (None if body is None else json.dumps(body).encode())
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    if body is not None and raw is None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = resp.read()
            text = payload.decode("utf-8", errors="replace")
            try:
                parsed = json.loads(text) if text else {}
            except json.JSONDecodeError:
                parsed = {"raw": "[non-json]"}
            return resp.status, parsed, payload
    except urllib.error.HTTPError as exc:
        payload = exc.read()
        text = payload.decode("utf-8", errors="replace")
        try:
            parsed = json.loads(text) if text else {}
        except json.JSONDecodeError:
            parsed = {"raw": text[:300]}
        return exc.code, parsed, payload


def token_for(email: str) -> str:
    base, service, anon = env("SUPABASE_URL").rstrip("/"), env("SUPABASE_SERVICE_ROLE_KEY"), env("SUPABASE_ANON_KEY")
    st, link, _ = http(
        f"{base}/auth/v1/admin/generate_link",
        method="POST",
        headers={"apikey": service, "Authorization": f"Bearer {service}"},
        body={"type": "magiclink", "email": email},
    )
    if st >= 400:
        raise SystemExit(f"generate_link {st}")
    st, verified, _ = http(
        f"{base}/auth/v1/verify",
        method="POST",
        headers={"apikey": anon, "Authorization": f"Bearer {anon}"},
        body={"type": "magiclink", "token_hash": link["hashed_token"]},
    )
    if st >= 400:
        raise SystemExit(f"verify {st}")
    return verified["access_token"]


def admin_plan(user_id: str, plan: str, credits: int) -> None:
    base, service = env("SUPABASE_URL").rstrip("/"), env("SUPABASE_SERVICE_ROLE_KEY")
    st, _, _ = http(
        f"{base}/rest/v1/rpc/admin_set_account_entitlement",
        method="POST",
        headers={"apikey": service, "Authorization": f"Bearer {service}"},
        body={"p_user_id": user_id, "p_plan_code": plan, "p_credit_balance": credits},
    )
    if st >= 400:
        raise SystemExit(f"admin_set {st}")


def copy_upload(user_id: str, token: str) -> str:
    """Copy known audio into user-owned upload path via service download + user upload."""
    base, service, anon = env("SUPABASE_URL").rstrip("/"), env("SUPABASE_SERVICE_ROLE_KEY"), env("SUPABASE_ANON_KEY")
    # download with service
    st, _, blob = http(
        f"{base}/storage/v1/object/uploads/{AUDIO}",
        headers={"apikey": service, "Authorization": f"Bearer {service}"},
        timeout=120,
    )
    if st >= 400 or not blob:
        raise SystemExit(f"download_source {st}")
    dest = f"{user_id}/{__import__('uuid').uuid4()}/{FILENAME}"
    st, meta, _ = http(
        f"{base}/storage/v1/object/uploads/{dest}",
        method="POST",
        headers={
            "apikey": anon,
            "Authorization": f"Bearer {token}",
            "Content-Type": "audio/mpeg",
            "x-upsert": "true",
        },
        raw=blob,
        timeout=120,
    )
    if st >= 400:
        raise SystemExit(f"upload_owned {st} {meta}")
    return dest


def wait_done(request_id: str, timeout_s: int = 600) -> dict:
    base, service = env("SUPABASE_URL").rstrip("/"), env("SUPABASE_SERVICE_ROLE_KEY")
    deadline = time.time() + timeout_s
    last = {}
    while time.time() < deadline:
        st, rows, _ = http(
            f"{base}/rest/v1/requests?id=eq.{request_id}&select=id,status,worker_kind,error,requested_by",
            headers={"apikey": service, "Authorization": f"Bearer {service}"},
        )
        last = rows[0] if rows else {}
        print(f"  {request_id} -> {last.get('status')}")
        if last.get("status") in {"done", "error"}:
            return last
        time.sleep(8)
    raise SystemExit(f"timeout {last}")


def main() -> None:
    # FREE duration rejection (no Modal)
    tok = token_for(USERS[0]["email"])
    admin_plan(USERS[0]["id"], "free", 3)
    path = copy_upload(USERS[0]["id"], tok)
    st, body, _ = http(
        f"{PROD}/api/create-request",
        method="POST",
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
        body={"filename": FILENAME, "audio_path": path},
    )
    print("free_long", st, body.get("code") or body.get("error"))
    assert st in {400, 402} and body.get("code") == "duration_exceeded"

    created = []
    for user in USERS:
        admin_plan(user["id"], "mini", 2)
        tok = token_for(user["email"])
        path = copy_upload(user["id"], tok)
        t0 = time.time()
        st, body, _ = http(
            f"{PROD}/api/create-request",
            method="POST",
            headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
            body={"filename": FILENAME, "audio_path": path},
        )
        print(f"user_{user['label']}_create", st, body.get("request_id"), body.get("code"))
        assert st == 200 and body.get("request_id")
        rid = body["request_id"]
        created.append((user, rid, tok, t0))

        # isolation: songs list only own
        base, anon = env("SUPABASE_URL").rstrip("/"), env("SUPABASE_ANON_KEY")
        st, songs, _ = http(
            f"{base}/rest/v1/songs?select=id,owner_id",
            headers={"apikey": anon, "Authorization": f"Bearer {tok}"},
        )
        assert st == 200
        assert all(s.get("owner_id") == user["id"] for s in songs)

    for user, rid, tok, t0 in created:
        done = wait_done(rid)
        assert done["status"] == "done", done
        assert done["requested_by"] == user["id"]
        print(f"user_{user['label']}_done_s={time.time()-t0:.1f}")

    # final checks
    base, service = env("SUPABASE_URL").rstrip("/"), env("SUPABASE_SERVICE_ROLE_KEY")
    st, outbox, _ = http(
        f"{base}/rest/v1/dispatch_outbox?select=state",
        headers={"apikey": service, "Authorization": f"Bearer {service}"},
    )
    assert all(r["state"] == "closed" for r in outbox)
    st, leases, _ = http(
        f"{base}/rest/v1/request_attempts?finished_at=is.null&select=id",
        headers={"apikey": service, "Authorization": f"Bearer {service}"},
    )
    assert leases == []
    print("e2e_beta_ok")


if __name__ == "__main__":
    main()
