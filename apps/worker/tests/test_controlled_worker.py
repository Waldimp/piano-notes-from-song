from __future__ import annotations

import json
import hashlib
import os
import sys
import threading
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT / "apps" / "worker"), str(ROOT / "ml")]

from piano_worker.controlled import (  # noqa: E402
    Claim,
    DispatchReceipt,
    StagingSafetyError,
    ack_or_reconcile_accepted,
    canonical_uuid,
    claim_exact,
    get_staging_client,
    production_canary_identity_from_env,
    redact_error,
    reserve_production_canary_spawn,
    settle_canary_cost,
    staging_identity_from_env,
    validate_checkpoint,
)
from piano_worker.controlled_publisher import CompensablePublisher  # noqa: E402
from piano_worker.reconciliation import reconcile_candidates  # noqa: E402


class Response:
    def __init__(self, data): self.data = data


class RpcCall:
    def __init__(self, client, name, params): self.client, self.name, self.params = client, name, params
    def execute(self):
        self.client.calls.append((self.name, self.params))
        return Response(self.client.rpc_results.get(self.name, True))


class Bucket:
    def __init__(self, client, name): self.client, self.name = client, name
    def upload(self, path, data, options):
        key = (self.name, path)
        if key in self.client.objects: raise RuntimeError("duplicate object")
        assert options["upsert"] == "false"
        self.client.objects[key] = bytes(data)
        if key in self.client.ambiguous_uploads:
            raise OSError("response lost after upload")
    def download(self, path):
        key = (self.name, path)
        if key not in self.client.objects: raise OSError("missing object")
        return self.client.objects[key]
    def list(self, folder, options=None):
        prefix = "" if folder == "." else f"{folder}/"
        return [{"name": path[len(prefix):]} for (bucket, path), _ in self.client.objects.items()
                if bucket == self.name and path.startswith(prefix) and "/" not in path[len(prefix):]]
    def remove(self, paths):
        for path in paths: self.client.objects.pop((self.name, path), None)


class Storage:
    def __init__(self, client): self.client = client
    def from_(self, name): return Bucket(self.client, name)


class FakeClient:
    def __init__(self):
        self.calls, self.objects, self.rpc_results = [], {}, {}
        self.ambiguous_uploads = set()
        self.storage = Storage(self)
    def rpc(self, name, params): return RpcCall(self, name, params)


def ids():
    return [str(uuid.uuid4()) for _ in range(5)]


def claim() -> Claim:
    request, attempt, lease, trace, _ = ids()
    return Claim(request, "sample.mp3", "u/sample.mp3", "song_target", attempt, lease, trace)


def output_dir(tmp_path: Path) -> Path:
    payload = {
        "version": 1, "duration": 3.2, "source": {"filename": "sample.mp3"},
        "transcription": {"engine": "synthetic"}, "notes": [{"pitch": 60}], "pedals": [],
    }
    (tmp_path / "notes.json").write_text(json.dumps(payload), encoding="utf-8")
    (tmp_path / "source.mp3").write_bytes(b"audio")
    return tmp_path


def test_explicit_canonical_uuid_only():
    value = str(uuid.uuid4())
    assert canonical_uuid(value) == value
    with pytest.raises(ValueError): canonical_uuid(value.upper())


def test_staging_client_refuses_legacy_or_missing(monkeypatch):
    monkeypatch.delenv("PIANO_ENVIRONMENT", raising=False)
    with pytest.raises(StagingSafetyError): get_staging_client()


def test_staging_identity_requires_manifest_binding(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    manifest = {
        "environment": "staging", "supabase_url": "https://abc123.supabase.co",
        "project_ref": "abc123", "modal_environment": "staging",
        "storage_namespace": "_staging",
        "modal_dispatch_url": "https://modal.example/dispatch",
    }
    raw = json.dumps(manifest, sort_keys=True, separators=(",", ":"))
    import hashlib
    digest = hashlib.sha256(raw.encode()).hexdigest()
    monkeypatch.setenv("PIANO_ENVIRONMENT", "staging")
    monkeypatch.setenv("STAGING_IDENTITY_MANIFEST", raw)
    monkeypatch.setenv("STAGING_IDENTITY_SHA256", digest)
    monkeypatch.setenv("STAGING_SUPABASE_URL", manifest["supabase_url"])
    monkeypatch.setenv("STAGING_MODAL_DISPATCH_URL", manifest["modal_dispatch_url"])
    with pytest.raises(StagingSafetyError, match="allowlist"):
        staging_identity_from_env()
    monkeypatch.setenv("STAGING_SUPABASE_URL", "https://other.supabase.co")
    with pytest.raises(StagingSafetyError): staging_identity_from_env()
    monkeypatch.setenv("PIANO_ENVIRONMENT", "staging")
    monkeypatch.setenv("STAGING_SUPABASE_URL", "https://staging.invalid")
    monkeypatch.setenv("STAGING_SUPABASE_SERVICE_ROLE_KEY", "same")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "same")
    with pytest.raises(StagingSafetyError): get_staging_client()


def test_production_canary_is_exact_and_fail_closed(monkeypatch):
    for name in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL", "SUPABASE_DB_URL",
                 "STAGING_SUPABASE_URL", "STAGING_SUPABASE_SERVICE_ROLE_KEY",
                 "STAGING_IDENTITY_MANIFEST", "STAGING_IDENTITY_SHA256", "STAGING_MODAL_DISPATCH_URL"):
        monkeypatch.delenv(name, raising=False)
    manifest = {
        "environment": "production-canary", "supabase_url": "https://prodref.supabase.co",
        "project_ref": "prodref", "modal_environment": "production-canary",
        "storage_namespace": "_staging", "modal_dispatch_url": "https://modal.example/canary",
    }
    raw = json.dumps(manifest, sort_keys=True, separators=(",", ":"))
    import hashlib
    monkeypatch.setenv("PIANO_ENVIRONMENT", "production-canary")
    monkeypatch.delenv("MODAL_ENVIRONMENT", raising=False)
    monkeypatch.setenv("PRODUCTION_CANARY_IDENTITY_MANIFEST", raw)
    monkeypatch.setenv("PRODUCTION_CANARY_IDENTITY_SHA256", hashlib.sha256(raw.encode()).hexdigest())
    monkeypatch.setenv("PRODUCTION_CANARY_SUPABASE_URL", manifest["supabase_url"])
    monkeypatch.setenv("PRODUCTION_CANARY_MODAL_DISPATCH_URL", manifest["modal_dispatch_url"])
    with pytest.raises(StagingSafetyError, match="Modal Environment"):
        production_canary_identity_from_env()
    monkeypatch.setenv("MODAL_ENVIRONMENT", "production-canary")
    with pytest.raises(StagingSafetyError, match="allowlist"):
        production_canary_identity_from_env()
    monkeypatch.setenv("DATABASE_URL", "https://generic.invalid")
    with pytest.raises(StagingSafetyError, match="generic"):
        production_canary_identity_from_env()


def test_production_canary_accepts_exactly_allowlisted_modal_root_endpoint(monkeypatch):
    allowlist_path = ROOT / "scripts" / "production-canary" / "identity-allowlist.json"
    manifest = json.loads(allowlist_path.read_text(encoding="utf-8"))["entries"][0]
    raw = json.dumps(manifest, sort_keys=True, separators=(",", ":"))
    import hashlib
    monkeypatch.setenv("PIANO_ENVIRONMENT", "production-canary")
    monkeypatch.setenv("MODAL_ENVIRONMENT", "production-canary")
    monkeypatch.setenv("PRODUCTION_CANARY_IDENTITY_MANIFEST", raw)
    monkeypatch.setenv("PRODUCTION_CANARY_IDENTITY_SHA256", hashlib.sha256(raw.encode()).hexdigest())
    monkeypatch.setenv("PRODUCTION_CANARY_SUPABASE_URL", manifest["supabase_url"])
    monkeypatch.setenv("PRODUCTION_CANARY_MODAL_DISPATCH_URL", manifest["modal_dispatch_url"])
    assert production_canary_identity_from_env().modal_dispatch_url == manifest["modal_dispatch_url"]


def test_production_canary_modal_contract_is_static():
    modal_file = (ROOT / "benchmarks/modal/controlled_migration/production_canary_worker.py").read_text()
    for token in ('add_local_dir(REPO_ROOT / "ml"', 'add_local_dir(REPO_ROOT / "apps" / "worker"',
                  '"scripts" / "production-canary"', 'remote_path="/root/scripts/production-canary"',
                  'CHECKPOINT_SHA256 =', "validate_checkpoint(CHECKPOINT_PATH, CHECKPOINT_SHA256)",
                  'gpu="T4"', "retries=0", "min_containers=0", "max_containers=1",
                  "@modal.concurrent(max_inputs=1)", "requires_proxy_auth=True",
                  "production-canary", "does not poll Supabase", "cost_reservation_id",
                  "settle_canary_cost", '"gpu": "T4"'):
        assert token in modal_file


def test_checkpoint_checksum_is_fail_closed(tmp_path):
    checkpoint = tmp_path / "checkpoint.pth"
    checkpoint.write_bytes(b"pinned-model")
    expected = hashlib.sha256(b"pinned-model").hexdigest()
    validate_checkpoint(checkpoint, expected)
    with pytest.raises(StagingSafetyError, match="mismatch"):
        validate_checkpoint(checkpoint, hashlib.sha256(b"other-model").hexdigest())


@pytest.mark.parametrize("outcome", ["unauthorized", "stale"])
def test_canary_spawn_reservation_fails_closed(outcome):
    client = FakeClient()
    client.rpc_results["reserve_production_canary_spawn"] = outcome
    receipt = DispatchReceipt(*ids()[:1], str(uuid.uuid4()), 1, 7, "edge-canary")
    assert reserve_production_canary_spawn(client, receipt) == outcome
    assert [name for name, _ in client.calls] == ["reserve_production_canary_spawn"]


def test_canary_spawn_reservation_consumes_one_armed_uuid():
    client = FakeClient()
    dispatch_id, request_id, *_ = ids()
    client.rpc_results["reserve_production_canary_spawn"] = "spawn"
    receipt = DispatchReceipt(dispatch_id, request_id, 1, 7, "edge-canary")
    assert reserve_production_canary_spawn(client, receipt) == "spawn"
    assert client.calls[0][0] == "reserve_production_canary_spawn"
    assert client.calls[0][1]["p_request_id"] == request_id


def test_canary_replay_returns_replay_without_second_reservation():
    client = FakeClient()
    dispatch_id, request_id, *_ = ids()
    client.rpc_results["reserve_production_canary_spawn"] = "replay"
    receipt = DispatchReceipt(dispatch_id, request_id, 1, 7, "edge-canary")
    assert reserve_production_canary_spawn(client, receipt) == "replay"
    assert len(client.calls) == 1


def test_settle_canary_cost_records_gpu_seconds_and_reservation():
    client = FakeClient()
    settle_canary_cost(client, 9, __import__("time").perf_counter() - 1, {"gpu": "T4"})
    name, params = client.calls[0]
    assert name == "settle_worker_cost"
    assert params["p_reservation_id"] == 9
    assert params["p_gpu_seconds"] > 0
    assert params["p_metadata"] == {"gpu": "T4"}


def test_ack_accepted_is_reconciled_when_ack_persistence_fails():
    client = FakeClient()
    client.rpc_results["ack_dispatch"] = False
    client.rpc_results["reconcile_dispatch"] = "acknowledged"
    dispatch_id, *_ = ids()
    ack_or_reconcile_accepted(client, dispatch_id, "edge-canary", "call-123")
    assert [name for name, _ in client.calls] == ["ack_dispatch", "reconcile_dispatch"]
    assert client.calls[1][1]["p_observed_state"] == "accepted"


def test_canary_dispatch_guard_precedes_reservation_and_reconcile_is_wired():
    source = (ROOT / "benchmarks/modal/controlled_migration/production_canary_worker.py").read_text()
    assert "consume_production_canary_uuid" not in source
    assert source.count("reserve_production_canary_spawn") >= 2
    assert '"reserve_dispatch_spawn"' not in source
    assert "ack_or_reconcile_accepted" in source


def test_runbook_separates_pre_up_from_post_up_schema():
    runbook = (ROOT / "docs/PRODUCTION_MIGRATION_READINESS.md").read_text()
    pre = runbook.split("### PRE-UP", 1)[1].split("### POST-UP", 1)[0]
    post = runbook.split("### POST-UP", 1)[1].split("## 4.", 1)[0]
    assert "target_song_id" not in pre
    assert "worker_control" not in pre
    assert "target_song_id" in post and "worker_control" in post
    assert "0003_production_canary_single_uuid.down.sql" in runbook
    assert "0002_modal_worker_controlled_staging.down.sql" in runbook
    assert "nunca usar `service_role` para armar" in runbook


def test_single_uuid_sql_guard_is_atomic_and_fail_closed():
    sql = (ROOT / "migrations/supabase/0003_production_canary_single_uuid.sql").read_text()
    down = (ROOT / "migrations/supabase/0003_production_canary_single_uuid.down.sql").read_text()
    for token in ("production_canary_arm", "for update", "reserve_production_canary_spawn",
                  "request_id is distinct from p_request_id", "owner to worker_control_owner",
                  "grant select, update on public.production_canary_arm to worker_control_owner",
                  "grant execute on function"):
        assert token in sql.lower()
    assert "consume_production_canary_uuid" not in sql.lower()
    assert "rollback refused" in down.lower()


def test_canary_security_definer_owner_and_minimal_privileges():
    sql = (ROOT / "migrations/supabase/0003_production_canary_single_uuid.sql").read_text().lower()
    assert sql.count("owner to worker_control_owner") == 2
    assert "create role worker_control_owner nologin" in (
        ROOT / "migrations/supabase/0002_modal_worker_controlled_staging.sql"
    ).read_text().lower()
    assert "alter role worker_control_owner" not in sql
    assert "revoke all on public.production_canary_arm from public, anon, authenticated, service_role" in sql
    assert "revoke all on function public.arm_production_canary_uuid(uuid)" in sql
    assert "revoke all on function public.reserve_production_canary_spawn(uuid,uuid,integer,bigint,text)" in sql
    assert "grant execute on function public.arm_production_canary_uuid(uuid)\n  to worker_control_admin" in sql
    assert "grant execute on function public.reserve_production_canary_spawn(uuid,uuid,integer,bigint,text)\n  to service_role" in sql


def test_canary_sql_transactional_outcomes_and_concurrency_contract():
    sql = (ROOT / "migrations/supabase/0003_production_canary_single_uuid.sql").read_text().lower()
    assert "if v_decision = 'spawn' then" in sql
    assert "if v_dispatch_state = 'acknowledged' then" in sql
    assert "return 'unauthorized'" in sql
    assert "begin;" in sql and "commit;" in sql
    # The singleton row lock serializes two callers; only the spawn branch updates consumed_at.
    assert sql.count("set consumed_at = clock_timestamp()") == 1


class CanaryReservationModel:
    """Behavioral oracle for the 0003 singleton lock and dispatch outcomes."""
    def __init__(self, armed_request):
        self.armed_request = armed_request
        self.consumed = False
        self.states = {}
        self.lock = threading.Lock()

    def reserve(self, dispatch_id, request_id):
        with self.lock:
            state = self.states.get(dispatch_id, "leased")
            if request_id != self.armed_request:
                return "unauthorized"
            if self.consumed:
                return "replay" if state == "acknowledged" else "unauthorized"
            if state != "leased":
                return "stale"
            self.states[dispatch_id] = "spawning"
            self.consumed = True
            return "spawn"


def test_canary_oracle_rejects_different_uuid_before_spawn():
    armed = str(uuid.uuid4())
    model = CanaryReservationModel(armed)
    assert model.reserve(str(uuid.uuid4()), str(uuid.uuid4())) == "unauthorized"
    assert model.consumed is False


def test_canary_oracle_stale_and_pre_spawn_failure_do_not_consume():
    armed = str(uuid.uuid4())
    model = CanaryReservationModel(armed)
    dispatch_id = str(uuid.uuid4())
    model.states[dispatch_id] = "closed"
    assert model.reserve(dispatch_id, armed) == "stale"
    assert model.consumed is False


def test_canary_oracle_replay_and_concurrency_produce_one_spawn():
    armed, dispatch_id = str(uuid.uuid4()), str(uuid.uuid4())
    model = CanaryReservationModel(armed)
    results = []
    threads = [threading.Thread(target=lambda: results.append(model.reserve(dispatch_id, armed))) for _ in range(2)]
    for thread in threads: thread.start()
    for thread in threads: thread.join()
    assert results.count("spawn") == 1
    assert model.consumed is True
    model.states[dispatch_id] = "acknowledged"
    assert model.reserve(dispatch_id, armed) == "replay"


def test_error_redaction():
    value = redact_error(RuntimeError("https://secret.invalid/x sb_secret_x"))
    assert "secret.invalid" not in value and "sb_secret_" not in value


def test_claim_passes_exact_receipt_to_common_rpc():
    dispatch, request, attempt, lease, trace = ids()
    client = FakeClient()
    client.rpc_results["claim_request"] = [{
        "request_id": request, "filename": "x.mp3", "audio_path": "upload/x",
        "target_song_id": "song_x", "attempt_id": attempt,
        "lease_token": lease, "trace_id": trace,
    }]
    receipt = DispatchReceipt(dispatch, request, 1, 7)
    result = claim_exact(client, receipt, "modal")
    assert result.request_id == request
    assert client.calls == [("claim_request", {
        "p_request_id": request, "p_worker_kind": "modal", "p_dispatch_id": dispatch,
        "p_attempt_no": 1, "p_worker_generation": 7, "p_lease_seconds": 720,
    })]


@pytest.mark.parametrize("point", [
    "after_stage_playback", "after_stage_notes", "after_commit_playback", "after_commit_notes",
])
def test_publisher_compensates_each_injected_failure(tmp_path, point):
    client, owned = FakeClient(), claim()
    def inject(actual):
        if actual == point: raise RuntimeError(f"injected:{point}")
    with pytest.raises(RuntimeError, match="injected"):
        CompensablePublisher(client, inject).publish(owned, output_dir(tmp_path), "Sample")
    assert client.objects == {}
    assert any(name == "mark_artifact_cleaned" for name, _ in client.calls)


def test_publisher_never_overwrites_existing_object(tmp_path):
    client, owned = FakeClient(), claim()
    existing = ("audio", f"_staging/{owned.request_id}/{owned.attempt_id}/source.mp3")
    client.objects[existing] = b"belongs-to-earlier-attempt"
    with pytest.raises(RuntimeError, match="conflict"):
        CompensablePublisher(client).publish(owned, output_dir(tmp_path), "Sample")
    assert client.objects[existing] == b"belongs-to-earlier-attempt"


def test_publisher_verifies_upload_that_committed_before_response_loss(tmp_path):
    client, owned = FakeClient(), claim()
    client.ambiguous_uploads.add(("audio", f"_staging/{owned.request_id}/{owned.attempt_id}/source.mp3"))
    publication = CompensablePublisher(client).publish(owned, output_dir(tmp_path), "Sample")
    assert publication.audio_path.endswith("/playback.m4a") is False
    assert len(client.objects) == 4
    assert any(name == "record_request_artifact" for name, _ in client.calls)


class ClaimModel:
    """Small concurrency oracle mirroring the SQL row-lock invariant."""
    def __init__(self): self.status, self.attempts, self.lock = "queued", 0, threading.Lock()
    def claim(self):
        with self.lock:
            if self.status != "queued": return False
            self.status, self.attempts = "processing", self.attempts + 1
            return True


def test_race_oracle_has_one_winner():
    model, results = ClaimModel(), []
    threads = [threading.Thread(target=lambda: results.append(model.claim())) for _ in range(32)]
    for thread in threads: thread.start()
    for thread in threads: thread.join()
    assert results.count(True) == 1 and model.attempts == 1


def test_twenty_synthetic_canary_oracles_finish_once():
    canaries = [ClaimModel() for _ in range(20)]
    for item in canaries:
        assert item.claim() is True
        item.status = "done"
        assert item.claim() is False
    assert all(item.status == "done" and item.attempts == 1 for item in canaries)


def test_reconciler_never_infers_not_found_from_timeout():
    client = FakeClient()
    dispatch, request, *_ = ids()
    client.rpc_results["list_dispatch_reconciliation_candidates"] = [{
        "dispatch_id": dispatch, "request_id": request, "state": "spawning",
    }]
    assert reconcile_candidates(client, lambda _candidate: None) == []
    assert not any(name == "reconcile_dispatch" for name, _ in client.calls)
    with pytest.raises(ValueError, match="explicit"):
        reconcile_candidates(client, lambda _candidate: {"observed_state": "not_found"})


def test_sql_and_modal_guards_are_present():
    sql = (ROOT / "migrations/supabase/0002_modal_worker_controlled_staging.sql").read_text()
    down = (ROOT / "migrations/supabase/0002_modal_worker_controlled_staging.down.sql").read_text()
    modal_file = (ROOT / "benchmarks/modal/controlled_migration/staging_worker.py").read_text()
    for token in ("security definer", "set search_path = pg_catalog", "from public, anon, authenticated",
                  "split_part(name, '/', 1) <> '_staging'", "automatic staging hard stop at usd 20",
                  "authorize_dispatch_spawn", "reconcile_dispatch", "lease_expires_at > clock_timestamp",
                  "songs.request_id is immutable"):
        assert token in sql.lower()
    assert "rollback refused" in down.lower()
    for token in ('gpu="T4"', "retries=0", "min_containers=0", "max_containers=1",
                  "@modal.concurrent(max_inputs=1)", "requires_proxy_auth=True"):
        assert token in modal_file
    dispatcher = (ROOT / "supabase/functions/dispatch-modal-staging/index.ts").read_text()
    for token in ("PRODUCTION_CANARY_DISPATCH_SHARED_SECRET",
                  "x-production-canary-dispatch-signature",
                  "x-production-canary-dispatch-nonce", "PRODUCTION_CANARY_IDENTITY_MANIFEST",
                  "lease_owner", "REVIEWED_PRODUCTION_CANARY_IDENTITIES"):
        assert token in dispatcher


def test_production_canary_dispatcher_is_explicit_and_fail_closed():
    dispatcher = (ROOT / "supabase/functions/dispatch-modal-staging/index.ts").read_text()
    assert 'required("PIANO_ENVIRONMENT") !== "production-canary"' in dispatcher
    assert 'assertProductionCanaryEnvironment(Deno.env.toObject())' in dispatcher
    assert 'const expected = ["attempt_no", "dispatch_id", "lease_owner", "request_id", "worker_generation"]' in dispatcher
    assert "an explicit complete receipt is required" in dispatcher
    assert "reserve_production_canary_spawn transactionally" in dispatcher
    assert "REVIEWED_PRODUCTION_CANARY_IDENTITIES" in dispatcher
    assert "PRODUCTION_CANARY_MODAL_PROXY_KEY" in dispatcher
    assert "consume_dispatch_auth_nonce" in dispatcher
    assert 'modal_dispatch_url: "https://waltermejia61-production-canary--piano-controlled-worker-a7a7df.modal.run"' in dispatcher
    assert "acquire_dispatch_slot" not in dispatcher
    assert '.from("requests")' not in dispatcher
    assert '.from("dispatch_outbox")' not in dispatcher


def test_production_canary_dispatcher_defers_unarmed_or_mismatched_uuid_to_transactional_gate():
    dispatcher = (ROOT / "supabase/functions/dispatch-modal-staging/index.ts").read_text()
    modal_worker = (ROOT / "benchmarks/modal/controlled_migration/production_canary_worker.py").read_text()
    migration = (ROOT / "migrations/supabase/0003_production_canary_single_uuid.sql").read_text()
    assert "reserve_production_canary_spawn transactionally before spawn" in dispatcher
    assert "decision = reserve_production_canary_spawn(client, receipt)" in modal_worker
    assert "if decision == \"unauthorized\":" in modal_worker
    assert "v_arm.request_id is null or v_arm.request_id is distinct from p_request_id" in migration


def test_production_canary_modal_web_endpoint_uses_sdk_supported_retry_contract():
    """The GPU class is explicitly non-retrying; Modal web endpoints have no retry option."""
    modal_worker = (ROOT / "benchmarks/modal/controlled_migration/production_canary_worker.py").read_text()
    assert '"fastapi[standard]"' in modal_worker
    assert '@app.cls(\n    gpu="T4"' in modal_worker
    assert "cpu=2.0, memory=4096, timeout=10 * 60, retries=0," in modal_worker
    assert "@app.function(image=image, secrets=[canary_secret], timeout=30," in modal_worker
    endpoint_block = modal_worker.split("@app.function(", 1)[1].split("def dispatch", 1)[0]
    assert "retries=" not in endpoint_block


def test_control_plane_owner_membership_is_transaction_scoped_for_supabase_postgres():
    for name in ("0002_modal_worker_controlled_staging.sql",):
        sql = (ROOT / "migrations/supabase" / name).read_text().lower()
        assert "grant worker_control_owner to current_user;" in sql
        assert "revoke worker_control_owner from current_user;" in sql
    for name in (
        "0002_modal_worker_controlled_staging.down.sql",
        "0003_production_canary_single_uuid.sql",
        "0003_production_canary_single_uuid.down.sql",
    ):
        sql = (ROOT / "migrations/supabase" / name).read_text().lower()
        assert "grant worker_control_owner to current_user with set true;" in sql
        assert "revoke set option for worker_control_owner from current_user;" in sql
    for name in ("0002_modal_worker_controlled_staging.sql", "0003_production_canary_single_uuid.sql"):
        sql = (ROOT / "migrations/supabase" / name).read_text().lower()
        assert "grant usage, create on schema public to worker_control_owner;" in sql
        assert "revoke create on schema public from worker_control_owner;" in sql
    canary_sql = (ROOT / "migrations/supabase/0003_production_canary_single_uuid.sql").read_text().lower()
    assert "alter role worker_control_owner" not in canary_sql
