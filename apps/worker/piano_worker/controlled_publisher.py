"""Compensable, no-overwrite Storage publisher for controlled workers."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from .controlled import Claim, rpc

FaultInjector = Callable[[str], None]


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def validate_notes(data: bytes) -> dict[str, Any]:
    document = json.loads(data)
    required = {"version", "duration", "source", "transcription", "notes", "pedals"}
    if set(document) != required or document.get("version") != 1:
        raise ValueError("notes.json does not satisfy the current exact contract")
    if not isinstance(document["notes"], list) or not isinstance(document["pedals"], list):
        raise ValueError("notes and pedals must be arrays")
    return document


@dataclass
class Publication:
    audio_path: str
    notes_path: str
    row: dict[str, Any]
    created_objects: list[tuple[str, str]] = field(default_factory=list)


class AmbiguousStorageOperation(RuntimeError):
    """Storage may have committed an operation whose response was lost."""


class StorageOwnershipConflict(RuntimeError):
    """An object exists but is not proven to belong to this attempt."""


class CompensablePublisher:
    def __init__(self, client: Any, fault: FaultInjector | None = None):
        self.client = client
        self.fault = fault or (lambda _point: None)

    def _verify_object(self, bucket: str, path: str, expected: bytes) -> bool:
        """Verify an object after an ambiguous upload, never by metadata alone."""
        storage = self.client.storage.from_(bucket)
        if not hasattr(storage, "download"):
            return False
        try:
            actual = storage.download(path)
        except Exception as exc:  # noqa: BLE001 - absence vs transport is ambiguous
            raise AmbiguousStorageOperation(
                f"cannot determine upload outcome for {bucket}/{path}"
            ) from exc
        if _sha256(actual) != _sha256(expected) or len(actual) != len(expected):
            raise StorageOwnershipConflict(f"object conflict at {bucket}/{path}")
        return True

    def _object_present(self, bucket: str, path: str) -> bool | None:
        storage = self.client.storage.from_(bucket)
        if not hasattr(storage, "list"):
            return None
        folder, _, name = path.rpartition("/")
        try:
            entries = storage.list(folder or ".", {"limit": 1000})
        except Exception as exc:  # noqa: BLE001 - do not guess after a delete
            raise AmbiguousStorageOperation(f"cannot verify {bucket}/{path}") from exc
        if entries is None:
            raise AmbiguousStorageOperation(f"cannot verify {bucket}/{path}")
        return any(entry.get("name") == name for entry in entries)

    def _upload_new(self, bucket: str, path: str, data: bytes, content_type: str) -> None:
        try:
            self.client.storage.from_(bucket).upload(
                path, data, {"content-type": content_type, "upsert": "false"}
            )
        except Exception as exc:  # noqa: BLE001 - upload may have committed first
            if not self._verify_object(bucket, path, data):
                raise
            # The caller records ownership in the same attempt-specific artifact
            # transaction.  A matching object is not silently overwritten.

    def _record(
        self, claim: Claim, bucket: str, path: str, kind: str, data: bytes, state: str
    ) -> None:
        rpc(
            self.client,
            "record_request_artifact",
            {
                "p_request_id": claim.request_id,
                "p_attempt_id": claim.attempt_id,
                "p_lease_token": claim.lease_token,
                "p_bucket": bucket,
                "p_object_path": path,
                "p_kind": kind,
                "p_sha256": _sha256(data),
                "p_size_bytes": len(data),
                "p_state": state,
            },
        )

    def publish(self, claim: Claim, output_dir: Path, title: str) -> Publication:
        notes_bytes = (output_dir / "notes.json").read_bytes()
        document = validate_notes(notes_bytes)
        playback = output_dir / "playback.m4a"
        if playback.is_file():
            audio_bytes, audio_name, media_type = playback.read_bytes(), "playback.m4a", "audio/mp4"
        else:
            source = next(p for p in output_dir.iterdir() if p.stem == "source")
            audio_bytes, audio_name = source.read_bytes(), source.name
            media_type = "audio/mpeg" if source.suffix.lower() == ".mp3" else "application/octet-stream"

        prefix = f"_staging/{claim.request_id}/{claim.attempt_id}"
        staged = [("audio", f"{prefix}/{audio_name}", "playback", audio_bytes, media_type),
                  ("notes", f"{prefix}/notes.json", "notes", notes_bytes, "application/json")]
        final = [("audio", f"{claim.target_song_id}/{audio_name}", "playback", audio_bytes, media_type),
                 ("notes", f"{claim.target_song_id}/notes.json", "notes", notes_bytes, "application/json")]
        created: list[tuple[str, str]] = []
        try:
            for bucket, path, kind, payload, content_type in staged:
                self._upload_new(bucket, path, payload, content_type)
                created.append((bucket, path))
                self._record(claim, bucket, path, kind, payload, "staged")
                self.fault(f"after_stage_{kind}")
            for bucket, path, kind, payload, content_type in final:
                self._upload_new(bucket, path, payload, content_type)
                created.append((bucket, path))
                self._record(claim, bucket, path, kind, payload, "committed")
                self.fault(f"after_commit_{kind}")

            row = {
                "id": claim.target_song_id,
                "title": title,
                "filename": document["source"].get("filename", title),
                "duration": float(document["duration"]),
                "note_count": len(document["notes"]),
                "pedal_count": len(document["pedals"]),
                "engine": document["transcription"].get("engine", ""),
                "audio_path": final[0][1],
                "notes_path": final[1][1],
            }
            return Publication(final[0][1], final[1][1], row, created)
        except Exception:
            self.compensate(claim, created)
            raise

    def compensate(self, claim: Claim, created: list[tuple[str, str]]) -> None:
        # Only deterministic paths with a matching artifact owned by this exact
        # attempt are removed.  If ownership cannot be verified, retain the
        # object for the reconciler; deletion is never best-effort.
        for bucket, path in reversed(created):
            owned = rpc(self.client, "get_owned_artifact", {
                "p_request_id": claim.request_id, "p_attempt_id": claim.attempt_id,
                "p_lease_token": claim.lease_token, "p_bucket": bucket,
                "p_object_path": path,
            })
            if isinstance(owned, list):
                owned = owned[0] if owned else None
            if owned is None and hasattr(self.client.storage.from_(bucket), "download"):
                continue
            storage = self.client.storage.from_(bucket)
            if isinstance(owned, dict) and hasattr(storage, "download"):
                try:
                    actual = storage.download(path)
                except Exception:
                    # An absent object is already safely cleaned; a transport
                    # failure is not evidence of absence.
                    if self._object_present(bucket, path) is not False:
                        raise AmbiguousStorageOperation(f"cannot verify owned object {bucket}/{path}")
                    actual = None
                if actual is not None and (
                    _sha256(actual) != owned.get("sha256") or len(actual) != owned.get("size_bytes")
                ):
                    raise StorageOwnershipConflict(f"refusing to delete unowned object {bucket}/{path}")
            try:
                self.client.storage.from_(bucket).remove([path])
            except Exception as exc:  # noqa: BLE001 - remove may commit first
                if self._object_present(bucket, path) is not False:
                    raise AmbiguousStorageOperation(
                        f"delete outcome is ambiguous for {bucket}/{path}"
                    ) from exc
            if self._object_present(bucket, path) is not False:
                raise AmbiguousStorageOperation(f"delete outcome is ambiguous for {bucket}/{path}")
            rpc(self.client, "mark_artifact_cleaned", {
                "p_request_id": claim.request_id, "p_attempt_id": claim.attempt_id,
                "p_lease_token": claim.lease_token, "p_bucket": bucket,
                "p_object_path": path,
            })

    def cleanup_staged(self, claim: Claim, created: list[tuple[str, str]]) -> None:
        """Remove private staging copies while the request lease is still held."""
        prefix = f"_staging/{claim.request_id}/{claim.attempt_id}/"
        staged = [(bucket, path) for bucket, path in created if path.startswith(prefix)]
        if staged:
            self.compensate(claim, staged)
