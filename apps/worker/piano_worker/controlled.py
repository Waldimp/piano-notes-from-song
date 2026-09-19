"""Shared controlled-worker primitives for isolated controlled migrations.

This module deliberately refuses generic SUPABASE_* variables.  The legacy
staging profile and the production-canary profile have separate names,
manifests, allowlists, and Modal environments.
"""

from __future__ import annotations

import os
import hashlib
import json
import re
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


class StagingSafetyError(RuntimeError):
    """The process is not unequivocally configured for isolated staging."""


def canonical_uuid(value: str) -> str:
    parsed = uuid.UUID(value)
    canonical = str(parsed)
    if value != canonical:
        raise ValueError("request_id must be a canonical explicit UUID")
    return canonical


def redact_error(exc: BaseException) -> str:
    message = str(exc)
    message = re.sub(r"https?://\S+", "[URL_REDACTED]", message)
    message = re.sub(r"\beyJ[A-Za-z0-9._-]{20,}\b", "[TOKEN_REDACTED]", message)
    message = re.sub(
        r"\b(?:sb_secret_|sb_publishable_)[A-Za-z0-9_-]+", "[TOKEN_REDACTED]", message
    )
    return f"{type(exc).__name__}: {message}"[:500]


def validate_checkpoint(path: Path, expected_sha256: str) -> None:
    """Fail closed before model construction when the pinned asset changes."""
    expected = expected_sha256.strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise StagingSafetyError("checkpoint SHA-256 is missing or invalid")
    try:
        actual = hashlib.sha256(path.read_bytes()).hexdigest().lower()
    except OSError as exc:
        raise StagingSafetyError("checkpoint is unavailable") from exc
    if not hmac_compare(actual, expected):
        raise StagingSafetyError("checkpoint SHA-256 mismatch")


def hmac_compare(left: str, right: str) -> bool:
    """Constant-time comparison without exposing credential material."""
    import hmac
    return hmac.compare_digest(left, right)


def _get_client(identity_loader: Any, credential_name: str) -> Any:
    identity = identity_loader()
    key = os.environ.get(credential_name)
    if not key:
        raise StagingSafetyError("the controlled service credential is missing")
    from supabase import create_client

    return create_client(identity.supabase_url, key)


def get_staging_client() -> Any:
    return _get_client(staging_identity_from_env, "STAGING_SUPABASE_SERVICE_ROLE_KEY")


@dataclass(frozen=True)
class StagingIdentity:
    """The non-secret deployment binding for one temporary staging target."""

    environment: str
    supabase_url: str
    project_ref: str
    modal_environment: str
    storage_namespace: str
    modal_dispatch_url: str


def staging_identity_from_env() -> StagingIdentity:
    """Validate an explicit identity manifest before any staging connection.

    The URL and project reference are never inferred from a variable name.  A
    deployment must provide a canonical manifest and its fingerprint, and the
    secret-side URL must match the manifest exactly.
    """
    return _identity_from_env(
        environment="staging", prefix="STAGING", allowlist_name="staging"
    )


def get_production_canary_client() -> Any:
    return _get_client(production_canary_identity_from_env, "PRODUCTION_CANARY_SUPABASE_SERVICE_ROLE_KEY")


def production_canary_identity_from_env() -> StagingIdentity:
    """Validate the exact production project binding used only for canaries.

    This intentionally retains ``_staging`` as a private Storage namespace;
    it is a publication namespace, not a second Supabase project.
    """
    return _identity_from_env(
        environment="production-canary", prefix="PRODUCTION_CANARY", allowlist_name="production-canary"
    )


def _identity_from_env(*, environment: str, prefix: str, allowlist_name: str) -> StagingIdentity:
    if os.environ.get("PIANO_ENVIRONMENT") != environment:
        raise StagingSafetyError(f"PIANO_ENVIRONMENT must equal '{environment}'")
    if environment == "production-canary" and os.environ.get("MODAL_ENVIRONMENT") != environment:
        raise StagingSafetyError("Modal Environment must equal 'production-canary'")
    if "MODAL_ENVIRONMENT" in os.environ and os.environ.get("MODAL_ENVIRONMENT") != environment:
        raise StagingSafetyError("Modal Environment is not bound to the controlled profile")
    forbidden = {
        "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL", "SUPABASE_DB_URL",
    }
    other_prefix = "PRODUCTION_CANARY" if prefix == "STAGING" else "STAGING"
    forbidden.update({
        f"{other_prefix}_SUPABASE_URL", f"{other_prefix}_SUPABASE_SERVICE_ROLE_KEY",
        f"{other_prefix}_IDENTITY_MANIFEST", f"{other_prefix}_IDENTITY_SHA256",
        f"{other_prefix}_MODAL_DISPATCH_URL",
    })
    if any(name in os.environ for name in forbidden):
        raise StagingSafetyError("generic or cross-environment variables must be absent")
    raw = os.environ.get(f"{prefix}_IDENTITY_MANIFEST")
    expected_digest = os.environ.get(f"{prefix}_IDENTITY_SHA256", "").lower()
    if not raw or not re.fullmatch(r"[0-9a-f]{64}", expected_digest):
        raise StagingSafetyError("controlled identity manifest and fingerprint are required")
    try:
        manifest = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise StagingSafetyError("staging identity manifest is not valid JSON") from exc
    canonical = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    if hashlib.sha256(canonical).hexdigest() != expected_digest:
        raise StagingSafetyError("staging identity fingerprint mismatch")
    required = (
        "environment", "supabase_url", "project_ref", "modal_environment",
        "storage_namespace", "modal_dispatch_url",
    )
    if not isinstance(manifest, dict) or any(not isinstance(manifest.get(key), str) for key in required):
        raise StagingSafetyError("staging identity manifest is incomplete")
    identity = StagingIdentity(*(manifest[key] for key in required))
    if identity.environment != environment or identity.modal_environment != environment:
        raise StagingSafetyError("controlled identity is not fixed to its exact environment")
    if identity.storage_namespace != "_staging":
        raise StagingSafetyError("unexpected staging storage namespace")
    parsed = urlparse(identity.supabase_url)
    if parsed.scheme != "https" or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise StagingSafetyError("staging Supabase URL must be an exact HTTPS origin")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,62}", identity.project_ref):
        raise StagingSafetyError("staging Supabase project reference is invalid")
    if parsed.hostname != f"{identity.project_ref}.supabase.co":
        raise StagingSafetyError("staging URL and project reference do not match")
    modal_url = urlparse(identity.modal_dispatch_url)
    if modal_url.scheme != "https" or not modal_url.hostname or modal_url.path in ("", "/"):
        raise StagingSafetyError("staging Modal endpoint must be an exact HTTPS endpoint")
    if modal_url.query or modal_url.fragment:
        raise StagingSafetyError("staging Modal endpoint cannot contain query or fragment data")
    if os.environ.get(f"{prefix}_SUPABASE_URL") != identity.supabase_url:
        raise StagingSafetyError("controlled URL is not the manifest-bound URL")
    if os.environ.get(f"{prefix}_MODAL_DISPATCH_URL") != identity.modal_dispatch_url:
        raise StagingSafetyError("controlled Modal endpoint is not manifest-bound")
    allowlist_path = Path(__file__).resolve().parents[3] / "scripts" / allowlist_name / "identity-allowlist.json"
    try:
        allowlist = json.loads(allowlist_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise StagingSafetyError("controlled identity allowlist is unavailable") from exc
    identity_fields = {
        "environment": identity.environment,
        "supabase_url": identity.supabase_url,
        "project_ref": identity.project_ref,
        "modal_environment": identity.modal_environment,
        "storage_namespace": identity.storage_namespace,
        "modal_dispatch_url": identity.modal_dispatch_url,
    }
    if not isinstance(allowlist, dict) or allowlist.get("version") != 1 or not any(
        isinstance(entry, dict)
        and all(entry.get(key) == value for key, value in identity_fields.items())
        for entry in allowlist.get("entries", [])
    ):
        raise StagingSafetyError("controlled identity is not in the reviewed allowlist")
    return identity


def rpc(client: Any, name: str, params: dict[str, Any]) -> Any:
    return client.rpc(name, params).execute().data


def reserve_production_canary_spawn(client: Any, receipt: DispatchReceipt) -> str:
    """Reserve one canary dispatch and consume its UUID in one DB transaction."""
    canonical = canonical_uuid(receipt.request_id)
    decision = rpc(client, "reserve_production_canary_spawn", {
        "p_dispatch_id": receipt.dispatch_id,
        "p_request_id": canonical,
        "p_attempt_no": receipt.attempt_no,
        "p_worker_generation": receipt.worker_generation,
        "p_lease_owner": receipt.lease_owner,
    })
    if decision not in {"spawn", "replay", "stale", "unauthorized"}:
        raise RuntimeError("canary spawn reservation returned an invalid decision")
    return decision


def ack_or_reconcile_accepted(client: Any, dispatch_id: str, lease_owner: str, call_id: str) -> None:
    """Persist ACK, or durably record an accepted spawn for reconciliation."""
    if rpc(client, "ack_dispatch", {
        "p_dispatch_id": dispatch_id, "p_lease_owner": lease_owner,
        "p_modal_call_id": call_id,
    }) is True:
        return
    reconciled = rpc(client, "reconcile_dispatch", {
        "p_dispatch_id": dispatch_id, "p_observation_id": f"modal-call:{call_id}",
        "p_observed_state": "accepted", "p_modal_call_id": call_id,
    })
    if reconciled != "acknowledged":
        raise RuntimeError("spawned call ACK was not persisted")


def settle_canary_cost(client: Any, reservation_id: int, started_at: float, metadata: dict[str, Any]) -> None:
    gpu_seconds = max(0.0, time.perf_counter() - started_at)
    observed = gpu_seconds * (0.000164 + 2 * 0.0000131 + 4 * 0.00000222)
    rpc(client, "settle_worker_cost", {
        "p_reservation_id": reservation_id, "p_observed_usd": observed,
        "p_gpu_seconds": gpu_seconds, "p_metadata": metadata,
    })


@dataclass(frozen=True)
class DispatchReceipt:
    dispatch_id: str
    request_id: str
    attempt_no: int
    worker_generation: int
    lease_owner: str = ""

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "DispatchReceipt":
        receipt = cls(
            dispatch_id=canonical_uuid(str(payload["dispatch_id"])),
            request_id=canonical_uuid(str(payload["request_id"])),
            attempt_no=int(payload["attempt_no"]),
            worker_generation=int(payload["worker_generation"]),
            lease_owner=str(payload.get("lease_owner", "")),
        )
        if receipt.attempt_no < 1 or receipt.worker_generation < 1 or not receipt.lease_owner:
            raise ValueError("dispatch receipt is incomplete")
        if len(receipt.lease_owner) > 120 or not re.fullmatch(r"[A-Za-z0-9._:-]+", receipt.lease_owner):
            raise ValueError("dispatch lease owner is invalid")
        return receipt


@dataclass(frozen=True)
class Claim:
    request_id: str
    filename: str
    audio_path: str
    target_song_id: str
    attempt_id: str
    lease_token: str
    trace_id: str


def claim_exact(client: Any, receipt: DispatchReceipt, worker_kind: str) -> Claim:
    data = rpc(
        client,
        "claim_request",
        {
            "p_request_id": receipt.request_id,
            "p_worker_kind": worker_kind,
            "p_dispatch_id": receipt.dispatch_id,
            "p_attempt_no": receipt.attempt_no,
            "p_worker_generation": receipt.worker_generation,
            "p_lease_seconds": 720,
        },
    )
    if not isinstance(data, list) or len(data) != 1:
        raise RuntimeError("claim_request returned no unique claim")
    row = data[0]
    return Claim(
        request_id=canonical_uuid(str(row["request_id"])),
        filename=str(row["filename"]),
        audio_path=str(row["audio_path"]),
        target_song_id=str(row["target_song_id"]),
        attempt_id=canonical_uuid(str(row["attempt_id"])),
        lease_token=canonical_uuid(str(row["lease_token"])),
        trace_id=canonical_uuid(str(row["trace_id"])),
    )
