from __future__ import annotations

import json
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
    canonical_uuid,
    claim_exact,
    get_staging_client,
    redact_error,
    staging_identity_from_env,
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


def test_error_redaction():
    value = redact_error(RuntimeError("https://secret.invalid/x sb_secret_abcdefghijk"))
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
    for token in ("STAGING_DISPATCH_SHARED_SECRET", "x-staging-dispatch-signature",
                  "x-staging-dispatch-nonce", "STAGING_IDENTITY_MANIFEST", "lease_owner",
                  "REVIEWED_STAGING_IDENTITIES"):
        assert token in dispatcher
