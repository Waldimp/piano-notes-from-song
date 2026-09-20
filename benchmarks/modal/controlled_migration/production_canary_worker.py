"""Production-canary Modal worker definition.

Prepared locally only.  The empty allowlist and paused control row make this
file intentionally non-deployable until the MASTER records exact identities.
It never polls Supabase; every invocation carries one explicit UUID receipt.
"""

from __future__ import annotations

import os
import time
from typing import Any
from pathlib import Path

import modal

APP_NAME = "piano-controlled-worker-production-canary"
MODAL_ENVIRONMENT = "production-canary"
SECRET_NAME = "piano-controlled-worker-production-canary-supabase"
VOLUME_NAME = "piano-controlled-worker-production-canary-assets"
CHECKPOINT_PATH = Path("/assets/note_F1=0.9677_pedal_F1=0.9186.pth")
CHECKPOINT_SHA256 = "C3FA9730725BF4A762F1C14BC80CD5986EACDA01B026F5A4A2525CD607876141"

if modal.is_local():
    REPO_ROOT = Path(__file__).resolve().parents[3]
else:
    REPO_ROOT = Path("/root")

image = modal.Image.debian_slim(python_version="3.12").apt_install("ffmpeg").pip_install(
    "torch==2.11.0", "numpy==2.5.2", "pydantic==2.13.5",
    "piano_transcription_inference==0.0.6", "librosa==1.0.0",
    "torchlibrosa==0.1.0", "soundfile==0.14.0", "mido==1.3.3",
    "matplotlib==3.11.1", "audioread==3.1.0", "supabase==2.31.0",
    "fastapi[standard]",
).env({"PYTHONPATH": "/root/ml:/root/apps/worker", "PIANO_ENVIRONMENT": MODAL_ENVIRONMENT})
if modal.is_local():
    image = image.add_local_dir(REPO_ROOT / "ml", remote_path="/root/ml")
    image = image.add_local_dir(REPO_ROOT / "apps" / "worker", remote_path="/root/apps/worker")
    image = image.add_local_dir(
        REPO_ROOT / "scripts" / "production-canary", remote_path="/root/scripts/production-canary"
    )

app = modal.App(APP_NAME, image=image)
assets = modal.Volume.from_name(VOLUME_NAME, create_if_missing=False, environment_name=MODAL_ENVIRONMENT)
canary_secret = modal.Secret.from_name(
    SECRET_NAME,
    required_keys=[
        "PRODUCTION_CANARY_SUPABASE_URL",
        "PRODUCTION_CANARY_SUPABASE_SERVICE_ROLE_KEY",
        "PRODUCTION_CANARY_MODAL_DISPATCH_URL",
        "PRODUCTION_CANARY_IDENTITY_MANIFEST",
        "PRODUCTION_CANARY_IDENTITY_SHA256",
    ],
    environment_name=MODAL_ENVIRONMENT,
)


@app.cls(
    gpu="T4", image=image, secrets=[canary_secret], volumes={"/assets": assets},
    cpu=2.0, memory=4096, timeout=10 * 60, retries=0,
    min_containers=0, max_containers=1, scaledown_window=2,
)
@modal.concurrent(max_inputs=1)
class ControlledT4CanaryWorker:
    @modal.enter()
    def load(self) -> None:
        if os.environ.get("MODAL_ENVIRONMENT") != MODAL_ENVIRONMENT:
            raise RuntimeError("refusing non-production-canary Modal Environment")
        from piano_worker.controlled import production_canary_identity_from_env, validate_checkpoint
        from piano_ml.engines.high_resolution import HighResolutionEngine
        production_canary_identity_from_env()
        validate_checkpoint(CHECKPOINT_PATH, CHECKPOINT_SHA256)
        self.engine = HighResolutionEngine(checkpoint_path=CHECKPOINT_PATH, device="cuda")
        self.engine._ensure_model()

    @modal.method()
    def process(self, receipt_payload: dict[str, Any]) -> dict[str, Any]:
        from piano_worker.controlled import (
            DispatchReceipt, get_production_canary_client, rpc, settle_canary_cost,
        )
        from piano_worker.controlled_runner import process_dispatch
        receipt = DispatchReceipt.from_payload(receipt_payload)
        reservation_id = int(receipt_payload["cost_reservation_id"])
        if reservation_id < 1:
            raise ValueError("cost_reservation_id must be positive")
        client = get_production_canary_client()
        started_at = time.perf_counter()
        try:
            return process_dispatch(client, self.engine, receipt, "modal")
        finally:
            # settle_canary_cost records settle_worker_cost even on failures.
            settle_canary_cost(client, reservation_id, started_at, {"gpu": "T4"})


@app.function(image=image, secrets=[canary_secret], timeout=30,
              min_containers=0, max_containers=1, scaledown_window=2)
@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)
def dispatch(receipt_payload: dict[str, Any]) -> dict[str, Any]:
    """Spawn exactly the supplied receipt; it does not poll Supabase."""
    from fastapi import HTTPException
    from piano_worker.controlled import (
        DispatchReceipt, get_production_canary_client,
        ack_or_reconcile_accepted, reserve_production_canary_spawn, rpc,
    )
    receipt = DispatchReceipt.from_payload(receipt_payload)
    client = get_production_canary_client()
    # One transaction validates UUID, locks the singleton, and reserves dispatch.
    decision = reserve_production_canary_spawn(client, receipt)
    if decision == "replay":
        return {"status": "already_acknowledged", "dispatch_id": receipt.dispatch_id}
    if decision == "unauthorized":
        raise HTTPException(status_code=409, detail="canary UUID is not armed for this dispatch")
    if decision != "spawn":
        raise HTTPException(status_code=409, detail="stale or ambiguous dispatch receipt")
    reservation_id = rpc(client, "reserve_worker_cost", {
        "p_request_id": receipt.request_id, "p_attempt_id": None, "p_estimated_usd": 0.03,
    })
    if reservation_id is None:
        rpc(client, "return_unspawned_dispatch", {
            "p_dispatch_id": receipt.dispatch_id, "p_reason": "budget kill switch active",
        })
        raise HTTPException(status_code=429, detail="canary budget kill switch is active")
    if rpc(client, "bind_dispatch_cost_reservation", {
        "p_dispatch_id": receipt.dispatch_id, "p_request_id": receipt.request_id,
        "p_reservation_id": reservation_id,
    }) is not True:
        rpc(client, "release_worker_cost", {
            "p_reservation_id": reservation_id, "p_reason": "reservation binding failed",
        })
        raise HTTPException(status_code=409, detail="stale cost reservation")
    if rpc(client, "authorize_dispatch_spawn", {
        "p_dispatch_id": receipt.dispatch_id, "p_request_id": receipt.request_id,
        "p_attempt_no": receipt.attempt_no, "p_worker_generation": receipt.worker_generation,
        "p_lease_owner": receipt.lease_owner, "p_reservation_id": reservation_id,
    }) is not True:
        rpc(client, "release_worker_cost", {
            "p_reservation_id": reservation_id, "p_reason": "spawn authorization stale",
        })
        rpc(client, "return_unspawned_dispatch", {
            "p_dispatch_id": receipt.dispatch_id, "p_reason": "spawn authorization stale",
        })
        raise HTTPException(status_code=409, detail="stale spawn authorization")
    receipt_payload = dict(receipt_payload, cost_reservation_id=reservation_id)
    try:
        call = ControlledT4CanaryWorker().process.spawn(receipt_payload)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="spawn outcome requires reconciliation") from exc
    ack_or_reconcile_accepted(client, receipt.dispatch_id, receipt.lease_owner, call.object_id)
    return {"status": "accepted", "dispatch_id": receipt.dispatch_id, "call_id": call.object_id}


@app.local_entrypoint()
def main() -> None:
    print("Prepared only; deployment requires a reviewed production-canary identity and explicit MASTER authorization.")
