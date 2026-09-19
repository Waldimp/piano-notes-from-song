"""One-shot controlled worker shared by Modal and opt-in local staging."""

from __future__ import annotations

import tempfile
import time
from pathlib import Path
from typing import Any

from .controlled import DispatchReceipt, claim_exact, redact_error, rpc
from .controlled_publisher import CompensablePublisher

UPLOADS_BUCKET = "uploads"


def process_dispatch(client: Any, engine: Any, receipt: DispatchReceipt, worker_kind: str) -> dict[str, Any]:
    from piano_ml.pipeline import transcribe_file

    started = time.perf_counter()
    claim = claim_exact(client, receipt, worker_kind)
    publication = None
    publisher = CompensablePublisher(client)
    try:
        with tempfile.TemporaryDirectory(prefix=f"piano-{worker_kind}-staging-") as tmp:
            root = Path(tmp)
            suffix = Path(claim.filename).suffix.lower() or ".mp3"
            input_path = root / f"input{suffix}"
            download_started = time.perf_counter()
            input_path.write_bytes(client.storage.from_(UPLOADS_BUCKET).download(claim.audio_path))
            download_s = time.perf_counter() - download_started
            rpc(client, "heartbeat_request", {
                "p_request_id": claim.request_id, "p_attempt_id": claim.attempt_id,
                "p_lease_token": claim.lease_token, "p_extend_seconds": 720,
            })

            inference_started = time.perf_counter()
            result = transcribe_file(input_path, engine=engine, output_root=root / "output")
            inference_s = time.perf_counter() - inference_started
            rpc(client, "heartbeat_request", {
                "p_request_id": claim.request_id, "p_attempt_id": claim.attempt_id,
                "p_lease_token": claim.lease_token, "p_extend_seconds": 720,
            })

            publish_started = time.perf_counter()
            publication = publisher.publish(
                claim, result.notes_path.parent, Path(claim.filename).stem
            )
            publish_s = time.perf_counter() - publish_started
            metrics = {
                "download_s": download_s, "pipeline_s": inference_s,
                "publish_s": publish_s, "worker_kind": worker_kind,
            }
            # Canonical objects remain hidden from authenticated Storage access
            # unless the songs row exists; remove private staging copies before
            # the final DB commit while the lease still authorizes cleanup.
            publisher.cleanup_staged(claim, publication.created_objects)
            finalize_params = {
                "p_request_id": claim.request_id, "p_attempt_id": claim.attempt_id,
                "p_lease_token": claim.lease_token, "p_song_id": claim.target_song_id,
                "p_title": publication.row["title"], "p_filename": publication.row["filename"],
                "p_duration": publication.row["duration"], "p_note_count": publication.row["note_count"],
                "p_pedal_count": publication.row["pedal_count"], "p_engine": publication.row["engine"],
                "p_audio_path": publication.audio_path, "p_notes_path": publication.notes_path,
                "p_metrics": metrics,
            }
            try:
                finalized = rpc(client, "finalize_request", finalize_params)
            except Exception:
                outcome = rpc(client, "inspect_attempt_outcome", {
                    "p_request_id": claim.request_id, "p_attempt_id": claim.attempt_id,
                    "p_lease_token": claim.lease_token,
                })
                if outcome == "done_owned":
                    finalized = True
                else:
                    raise
            if finalized is not True:
                raise RuntimeError("finalize_request did not acknowledge completion")
            return {
                "request_id": claim.request_id, "status": "done",
                "song_id": claim.target_song_id, "notes": publication.row["note_count"],
                "pedals": publication.row["pedal_count"], "metrics": metrics,
                "total_s": time.perf_counter() - started,
            }
    except Exception as exc:
        safe = redact_error(exc)
        if publication is not None:
            outcome = rpc(client, "inspect_attempt_outcome", {
                "p_request_id": claim.request_id, "p_attempt_id": claim.attempt_id,
                "p_lease_token": claim.lease_token,
            })
            if outcome == "done_owned":
                return {
                    "request_id": claim.request_id, "status": "done",
                    "song_id": claim.target_song_id, "reconciled": True,
                    "total_s": time.perf_counter() - started,
                }
            if outcome != "active_owned":
                raise RuntimeError(f"ambiguous attempt retained for reconciliation: {safe}") from exc
            publisher.compensate(claim, publication.created_objects)
        rpc(client, "fail_request_attempt", {
            "p_request_id": claim.request_id, "p_attempt_id": claim.attempt_id,
            "p_lease_token": claim.lease_token, "p_failure_code": type(exc).__name__[:80],
            "p_error": safe, "p_retryable": False, "p_backoff_seconds": 60,
        })
        raise RuntimeError(safe) from exc
