"""Shared controlled-worker primitives for the isolated staging migration.

This module deliberately refuses the legacy SUPABASE_* variables.  It is used
by both the Modal T4 worker and the opt-in local staging path.
"""

from __future__ import annotations

import os
import hashlib
import json
import re
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


def get_staging_client() -> Any:
    identity = staging_identity_from_env()
    key = os.environ.get("STAGING_SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise StagingSafetyError("the staging service credential is missing")
    from supabase import create_client

    return create_client(identity.supabase_url, key)


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
    if os.environ.get("PIANO_ENVIRONMENT") != "staging":
        raise StagingSafetyError("PIANO_ENVIRONMENT must equal 'staging'")
    if "MODAL_ENVIRONMENT" in os.environ and os.environ.get("MODAL_ENVIRONMENT") != "staging":
        raise StagingSafetyError("Modal Environment must equal 'staging'")
    if "SUPABASE_URL" in os.environ or "SUPABASE_SERVICE_ROLE_KEY" in os.environ:
        raise StagingSafetyError("legacy Supabase variables must be absent in controlled staging")
    raw = os.environ.get("STAGING_IDENTITY_MANIFEST")
    expected_digest = os.environ.get("STAGING_IDENTITY_SHA256", "").lower()
    if not raw or not re.fullmatch(r"[0-9a-f]{64}", expected_digest):
        raise StagingSafetyError("staging identity manifest and fingerprint are required")
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
    if identity.environment != "staging" or identity.modal_environment != "staging":
        raise StagingSafetyError("staging identity is not fixed to the staging environment")
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
    if os.environ.get("STAGING_SUPABASE_URL") != identity.supabase_url:
        raise StagingSafetyError("staging URL is not the manifest-bound URL")
    if os.environ.get("STAGING_MODAL_DISPATCH_URL") != identity.modal_dispatch_url:
        raise StagingSafetyError("staging Modal endpoint is not manifest-bound")
    allowlist_path = Path(__file__).resolve().parents[3] / "scripts" / "staging" / "identity-allowlist.json"
    try:
        allowlist = json.loads(allowlist_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise StagingSafetyError("staging identity allowlist is unavailable") from exc
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
        raise StagingSafetyError("staging identity is not in the reviewed allowlist")
    return identity


def rpc(client: Any, name: str, params: dict[str, Any]) -> Any:
    return client.rpc(name, params).execute().data


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
