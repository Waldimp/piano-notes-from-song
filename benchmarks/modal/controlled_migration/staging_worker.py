"""Modal staging worker. Never deploy this app into the production Environment."""

from __future__ import annotations

import hashlib
import os
import sys
import time
from pathlib import Path
from typing import Any

import modal

APP_NAME = "piano-controlled-worker-staging"
SECRET_NAME = "piano-controlled-worker-staging-supabase"
VOLUME_NAME = "piano-controlled-worker-staging-assets"
CHECKPOINT_PATH = Path("/assets/note_F1=0.9677_pedal_F1=0.9186.pth")
CHECKPOINT_SHA256 = "C3FA9730725BF4A762F1C14BC80CD5986EACDA01B026F5A4A2525CD607876141"

if modal.is_local():
    REPO_ROOT = Path(__file__).resolve().parents[3]
else:
    REPO_ROOT = Path("/root")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg")
    .pip_install(
        "torch==2.11.0", "numpy==2.5.2", "pydantic==2.13.5",
        "piano_transcription_inference==0.0.6", "librosa==1.0.0",
        "torchlibrosa==0.1.0", "soundfile==0.14.0", "mido==1.3.3",
        "matplotlib==3.11.1", "audioread==3.1.0", "supabase==2.31.0",
    )
    .env({"PYTHONPATH": "/root/ml:/root/apps/worker", "PIANO_ENVIRONMENT": "staging"})
)
if modal.is_local():
    image = image.add_local_dir(REPO_ROOT / "ml", remote_path="/root/ml").add_local_dir(
        REPO_ROOT / "apps" / "worker", remote_path="/root/apps/worker"
    ).add_local_dir(REPO_ROOT / "scripts" / "staging", remote_path="/root/scripts/staging")

app = modal.App(APP_NAME, image=image)
assets = modal.Volume.from_name(VOLUME_NAME, create_if_missing=False, environment_name="staging")
staging_secret = modal.Secret.from_name(
    SECRET_NAME,
    required_keys=[
        "STAGING_SUPABASE_URL", "STAGING_SUPABASE_SERVICE_ROLE_KEY",
        "STAGING_MODAL_DISPATCH_URL", "STAGING_IDENTITY_MANIFEST",
        "STAGING_IDENTITY_SHA256",
    ],
    environment_name="staging",
)


@app.cls(
    gpu="T4", image=image, secrets=[staging_secret], volumes={"/assets": assets},
    cpu=2.0, memory=4096, timeout=10 * 60, retries=0,
    min_containers=0, max_containers=1, scaledown_window=2,
)
@modal.concurrent(max_inputs=1)
class ControlledT4Worker:
    @modal.enter()
    def load(self) -> None:
        if os.environ.get("MODAL_ENVIRONMENT") != "staging":
            raise RuntimeError("refusing non-staging Modal Environment")
        from piano_worker.controlled import staging_identity_from_env
        staging_identity_from_env()
        digest = hashlib.sha256(CHECKPOINT_PATH.read_bytes()).hexdigest().upper()
        if digest != CHECKPOINT_SHA256:
            raise RuntimeError("checkpoint SHA-256 mismatch")
        from piano_ml.engines.high_resolution import HighResolutionEngine

        self.engine = HighResolutionEngine(checkpoint_path=CHECKPOINT_PATH, device="cuda")
        self.engine._ensure_model()

    @modal.method()
    def process(self, receipt_payload: dict[str, Any]) -> dict[str, Any]:
        from piano_worker.controlled import DispatchReceipt, get_staging_client, rpc
        from piano_worker.controlled_runner import process_dispatch

        receipt = DispatchReceipt.from_payload(receipt_payload)
        reservation_id = int(receipt_payload["cost_reservation_id"])
        client = get_staging_client()
        started = time.perf_counter()
        try:
            return process_dispatch(client, self.engine, receipt, "modal")
        finally:
            gpu_seconds = time.perf_counter() - started
            # Same pinned estimate used by the prior benchmark, including CPU/RAM.
            observed = gpu_seconds * (0.000164 + 2 * 0.0000131 + 4 * 0.00000222)
            rpc(client, "settle_worker_cost", {
                "p_reservation_id": reservation_id, "p_observed_usd": observed,
                "p_gpu_seconds": gpu_seconds, "p_metadata": {"gpu": "T4"},
            })


@app.function(
    image=image, secrets=[staging_secret], timeout=30, retries=0,
    min_containers=0, max_containers=1, scaledown_window=2,
)
@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)
def dispatch(receipt_payload: dict[str, Any]) -> dict[str, Any]:
    """ACK only after a single durable spawn; never polls Supabase for work."""
    from fastapi import HTTPException
    from piano_worker.controlled import DispatchReceipt, get_staging_client, rpc

    receipt = DispatchReceipt.from_payload(receipt_payload)
    client = get_staging_client()
    decision = rpc(client, "reserve_dispatch_spawn", {
        "p_dispatch_id": receipt.dispatch_id, "p_request_id": receipt.request_id,
        "p_attempt_no": receipt.attempt_no,
        "p_worker_generation": receipt.worker_generation,
        "p_lease_owner": receipt.lease_owner,
    })
    if decision == "replay":
        return {"status": "already_acknowledged", "dispatch_id": receipt.dispatch_id}
    if decision == "stale":
        raise HTTPException(status_code=409, detail="stale dispatch receipt")
    if decision != "spawn":
        raise HTTPException(status_code=409, detail="ambiguous spawn requires reconciliation")
    reservation_id = rpc(client, "reserve_worker_cost", {
        "p_request_id": receipt.request_id, "p_attempt_id": None,
        "p_estimated_usd": 0.03,
    })
    if reservation_id is None:
        rpc(client, "return_unspawned_dispatch", {
            "p_dispatch_id": receipt.dispatch_id, "p_reason": "budget reservation rejected",
        })
        raise HTTPException(status_code=429, detail="staging budget kill switch is active")
    bound = rpc(client, "bind_dispatch_cost_reservation", {
        "p_dispatch_id": receipt.dispatch_id, "p_request_id": receipt.request_id,
        "p_reservation_id": reservation_id,
    })
    if bound is not True:
        rpc(client, "release_worker_cost", {
            "p_reservation_id": reservation_id, "p_reason": "dispatch reservation binding failed",
        })
        raise HTTPException(status_code=409, detail="stale cost reservation")
    authorized = rpc(client, "authorize_dispatch_spawn", {
        "p_dispatch_id": receipt.dispatch_id, "p_request_id": receipt.request_id,
        "p_attempt_no": receipt.attempt_no,
        "p_worker_generation": receipt.worker_generation,
        "p_lease_owner": receipt.lease_owner, "p_reservation_id": reservation_id,
    })
    if authorized is not True:
        rpc(client, "release_worker_cost", {
            "p_reservation_id": reservation_id, "p_reason": "spawn authorization became stale",
        })
        rpc(client, "return_unspawned_dispatch", {
            "p_dispatch_id": receipt.dispatch_id, "p_reason": "spawn authorization became stale",
        })
        raise HTTPException(status_code=409, detail="stale spawn authorization")
    receipt_payload = dict(receipt_payload)
    receipt_payload["cost_reservation_id"] = reservation_id
    try:
        call = ControlledT4Worker().process.spawn(receipt_payload)
    except Exception:
        # Modal may have accepted the call before the client observed an
        # exception.  Keep `spawning` and the reservation; only the durable
        # reconciler may decide not-found versus accepted.  Reopening here
        # would permit a second spawn and double cost.
        raise HTTPException(status_code=503, detail="spawn outcome requires reconciliation")
    call_id = call.object_id
    if rpc(client, "ack_dispatch", {
        "p_dispatch_id": receipt.dispatch_id, "p_lease_owner": receipt.lease_owner,
        "p_modal_call_id": call_id,
    }) is not True:
        reconciled = rpc(client, "reconcile_dispatch", {
            "p_dispatch_id": receipt.dispatch_id,
            "p_observation_id": f"modal-call:{call_id}",
            "p_observed_state": "accepted", "p_modal_call_id": call_id,
        })
        if reconciled != "acknowledged":
            raise HTTPException(status_code=503, detail="spawned call ACK was not persisted")
    return {"status": "accepted", "dispatch_id": receipt.dispatch_id, "call_id": call_id}


@app.local_entrypoint()
def main() -> None:
    print("Deploy only with: modal deploy --env staging benchmarks/modal/controlled_migration/staging_worker.py")
