"""CPU-only durable dispatch reconciliation for the controlled staging path.

The external Modal observation is deliberately injected.  This module never
turns a timeout into ``not_found``: a caller must supply a stable observation
id and an explicit Modal-side result before the SQL state can move.
"""

from __future__ import annotations

import hashlib
from typing import Any, Callable

from .controlled import rpc


Observation = dict[str, str | None]


def reconcile_candidates(
    client: Any,
    observe: Callable[[dict[str, Any]], Observation | None],
    limit: int = 20,
) -> list[dict[str, Any]]:
    candidates = rpc(client, "list_dispatch_reconciliation_candidates", {
        "p_limit": limit, "p_min_age_seconds": 30,
    }) or []
    results: list[dict[str, Any]] = []
    for candidate in candidates:
        observation = observe(candidate)
        if observation is None:
            continue
        observation_id = observation.get("observation_id")
        state = observation.get("observed_state")
        call_id = observation.get("modal_call_id")
        if not observation_id or state not in ("accepted", "not_found"):
            raise ValueError("reconciler observations must be explicit and stable")
        if state == "accepted" and not call_id:
            raise ValueError("accepted reconciliation requires modal_call_id")
        if state == "not_found" and call_id is not None:
            raise ValueError("not_found reconciliation cannot carry modal_call_id")
        result = rpc(client, "reconcile_dispatch", {
            "p_dispatch_id": candidate["dispatch_id"],
            "p_observation_id": observation_id,
            "p_observed_state": state,
            "p_modal_call_id": call_id,
        })
        results.append({"dispatch_id": candidate["dispatch_id"], "result": result})
    return results


def cleanup_completed_staging(client: Any, limit: int = 100) -> list[str]:
    """Delete only hash-matching staged objects from already completed jobs."""
    rows = rpc(client, "list_completed_staging_artifacts", {"p_limit": limit}) or []
    cleaned: list[str] = []
    for row in rows:
        bucket, path = row["bucket"], row["object_path"]
        storage = client.storage.from_(bucket)
        actual = storage.download(path)
        if hashlib.sha256(actual).hexdigest() != row["sha256"] or len(actual) != row["size_bytes"]:
            raise RuntimeError(f"staging artifact ownership conflict at {bucket}/{path}")
        storage.remove([path])
        folder, _, name = path.rpartition("/")
        entries = storage.list(folder or ".", {"limit": 1000})
        if entries is None:
            raise RuntimeError(f"staging artifact listing is ambiguous at {bucket}/{path}")
        if any(entry.get("name") == name for entry in entries):
            raise RuntimeError(f"staging artifact delete is ambiguous at {bucket}/{path}")
        if rpc(client, "mark_completed_staging_artifact_cleaned", {
            "p_request_id": row["request_id"], "p_attempt_id": row["attempt_id"],
            "p_bucket": bucket, "p_object_path": path,
            "p_sha256": row["sha256"], "p_size_bytes": row["size_bytes"],
        }) is True:
            cleaned.append(path)
    return cleaned
