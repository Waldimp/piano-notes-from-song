"""POC aislado: procesa exactamente un request explícito de Supabase en T4.

No hace polling, no consulta el job más antiguo y no modifica el worker local.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import modal


APP_NAME = "piano-modal-worker-poc"
SECRET_NAME = "piano-modal-worker-poc-supabase"
VOLUME_NAME = "piano-modal-benchmark-assets"
CHECKPOINT_PATH = Path("/assets/note_F1=0.9677_pedal_F1=0.9186.pth")
CHECKPOINT_SHA256 = "C3FA9730725BF4A762F1C14BC80CD5986EACDA01B026F5A4A2525CD607876141"
RESULT_PATH = Path(__file__).with_name("worker_poc_result.json")

T4_USD_PER_SECOND = 0.000164
CPU_USD_PER_CORE_SECOND = 0.0000131
MEMORY_USD_PER_GIB_SECOND = 0.00000222
CPU_CORES = 2.0
MEMORY_GIB = 4.0

if modal.is_local():
    REPO_ROOT = Path(__file__).resolve().parents[2]
else:
    REPO_ROOT = Path("/root")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg")
    .pip_install(
        "torch==2.11.0",
        "numpy==2.5.2",
        "pydantic==2.13.5",
        "piano_transcription_inference==0.0.6",
        "librosa==1.0.0",
        "torchlibrosa==0.1.0",
        "soundfile==0.14.0",
        "mido==1.3.3",
        "matplotlib==3.11.1",
    )
    .pip_install("audioread==3.1.0")
    .pip_install("supabase==2.31.0", "python-dotenv==1.2.3")
)
if modal.is_local():
    image = (
        image.env({"PYTHONPATH": "/root/ml:/root/apps/worker"})
        .add_local_dir(REPO_ROOT / "ml", remote_path="/root/ml")
        .add_local_dir(
            REPO_ROOT / "apps" / "worker", remote_path="/root/apps/worker"
        )
    )

assets = modal.Volume.from_name(VOLUME_NAME, create_if_missing=False)
supabase_secret = modal.Secret.from_name(
    SECRET_NAME,
    required_keys=["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
)
app = modal.App(APP_NAME, image=image)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _canonical_request_id(value: str) -> str:
    parsed = uuid.UUID(value)
    canonical = str(parsed)
    if value.lower() != canonical:
        raise ValueError("request_id debe ser un UUID canónico explícito")
    return canonical


def _safe_error(exc: Exception) -> str:
    """Evita guardar/loguear URLs, JWTs o tokens accidentales."""
    message = str(exc)
    message = re.sub(r"https?://\S+", "[URL_REDACTED]", message)
    message = re.sub(r"\beyJ[A-Za-z0-9._-]{20,}\b", "[TOKEN_REDACTED]", message)
    message = re.sub(r"\b(?:sb_secret_|sb_publishable_)[A-Za-z0-9_-]+", "[TOKEN_REDACTED]", message)
    return f"{type(exc).__name__}: {message}"[:500]


def _validate_published_contract(client: Any, row: dict[str, Any]) -> dict[str, Any]:
    payload = client.storage.from_("notes").download(row["notes_path"])
    data = json.loads(payload)
    expected_fields = {"version", "duration", "source", "transcription", "notes", "pedals"}
    fields_exact = set(data) == expected_fields
    notes = len(data.get("notes", []))
    pedals = len(data.get("pedals", []))
    valid = (
        fields_exact
        and data.get("version") == 1
        and notes == int(row["note_count"])
        and pedals == int(row["pedal_count"])
        and abs(float(data["duration"]) - float(row["duration"])) <= 0.001
    )
    return {
        "valid": valid,
        "fields_exact": fields_exact,
        "duration_s": float(data.get("duration", 0)),
        "notes": notes,
        "pedals": pedals,
        "engine": data.get("transcription", {}).get("engine"),
    }


@app.cls(
    gpu="T4",
    image=image,
    secrets=[supabase_secret],
    volumes={"/assets": assets},
    cpu=CPU_CORES,
    memory=int(MEMORY_GIB * 1024),
    timeout=10 * 60,
    retries=0,
    min_containers=0,
    max_containers=1,
    scaledown_window=2,
)
class ExplicitRequestWorker:
    @modal.enter()
    def enter(self) -> None:
        enter_started = time.perf_counter()
        import hashlib
        import importlib.metadata

        import torch
        from piano_ml.engines.high_resolution import HighResolutionEngine

        digest = hashlib.sha256(CHECKPOINT_PATH.read_bytes()).hexdigest().upper()
        if digest != CHECKPOINT_SHA256:
            raise RuntimeError("El checkpoint del Volume no coincide con el esperado")

        imports_done = time.perf_counter()
        model_started = time.perf_counter()
        self.engine = HighResolutionEngine(checkpoint_path=CHECKPOINT_PATH, device="cuda")
        self.engine._ensure_model()
        torch.cuda.synchronize()
        self.startup = {
            "runtime_imports_s": imports_done - enter_started,
            "model_load_s": time.perf_counter() - model_started,
            "gpu": torch.cuda.get_device_name(0),
            "torch": str(torch.__version__),
            "python": sys.version.split()[0],
            "piano_transcription_inference": importlib.metadata.version(
                "piano-transcription-inference"
            ),
        }
        self.container_entered_at = enter_started

    @modal.method()
    def process(self, request_id: str) -> str:
        from piano_ml.pipeline import transcribe_file
        from piano_worker.cloud import UPLOADS_BUCKET, get_client, publish_song, slugify

        started = time.perf_counter()
        request_id = _canonical_request_id(request_id)
        client = get_client()
        claimed = False
        temp_root: Path | None = None

        rows = (
            client.table("requests")
            .select("id,filename,audio_path,status,song_id")
            .eq("id", request_id)
            .limit(1)
            .execute()
            .data
        )
        if not rows:
            return json.dumps({"processed": False, "reason": "request_not_found"})

        request = rows[0]
        if request["status"] != "queued":
            return json.dumps(
                {
                    "processed": False,
                    "reason": "request_not_queued",
                    "status": request["status"],
                    "song_id": request.get("song_id"),
                }
            )

        base_slug = slugify(request["filename"])
        song_id = f"{base_slug}_modal_poc_{uuid.UUID(request_id).hex[:8]}"
        existing = client.table("songs").select("id").eq("id", song_id).limit(1).execute().data
        if existing:
            return json.dumps(
                {"processed": False, "reason": "poc_song_already_exists", "song_id": song_id}
            )

        claim = (
            client.table("requests")
            .update({"status": "processing", "started_at": _now(), "error": None})
            .eq("id", request_id)
            .eq("status", "queued")
            .execute()
        )
        if not claim.data:
            return json.dumps({"processed": False, "reason": "atomic_claim_lost"})
        claimed = True

        try:
            with tempfile.TemporaryDirectory(prefix="piano-modal-worker-poc-") as tmp:
                temp_root = Path(tmp)
                ext = Path(request["filename"]).suffix.lower() or ".mp3"
                input_dir = temp_root / "input"
                output_dir = temp_root / "output"
                input_dir.mkdir(parents=True)
                audio_path = input_dir / f"{song_id}{ext}"

                download_started = time.perf_counter()
                audio_bytes = client.storage.from_(UPLOADS_BUCKET).download(request["audio_path"])
                audio_path.write_bytes(audio_bytes)
                download_s = time.perf_counter() - download_started

                pipeline_started = time.perf_counter()
                result = transcribe_file(audio_path, engine=self.engine, output_root=output_dir)
                pipeline_s = time.perf_counter() - pipeline_started

                publish_started = time.perf_counter()
                row = publish_song(
                    result.notes_path.parent,
                    title=Path(request["filename"]).stem,
                    client=client,
                )
                contract = _validate_published_contract(client, row)
                if not contract["valid"]:
                    raise RuntimeError("El notes.json publicado no cumple el contrato esperado")
                publish_s = time.perf_counter() - publish_started

                completed = client.table("requests").update(
                    {
                        "status": "done",
                        "song_id": song_id,
                        "finished_at": _now(),
                        "error": None,
                    }
                ).eq("id", request_id).eq("status", "processing").execute()
                if not completed.data:
                    raise RuntimeError("No se pudo confirmar la transición processing -> done")

                final_rows = (
                    client.table("requests")
                    .select("id,status,song_id")
                    .eq("id", request_id)
                    .limit(1)
                    .execute()
                    .data
                )
                final = final_rows[0] if final_rows else {}
                if final.get("status") != "done" or final.get("song_id") != song_id:
                    raise RuntimeError("El estado final del request no coincide con la publicación")

                client.storage.from_(UPLOADS_BUCKET).remove([request["audio_path"]])

                response = {
                    "processed": True,
                    "request_id": request_id,
                    "status": "done",
                    "song_id": song_id,
                    "audio_bytes": len(audio_bytes),
                    "audio_duration_s": result.audio_duration,
                    "notes": len(result.transcription.notes),
                    "pedals": len(result.transcription.pedals),
                    "dropped_events": result.dropped_events,
                    "download_s": download_s,
                    "pipeline_s": pipeline_s,
                    "publish_and_verify_s": publish_s,
                    "remote_end_to_end_s": time.perf_counter() - started,
                    "gpu_active_s": time.perf_counter() - self.container_entered_at,
                    "contract": contract,
                    "startup": self.startup,
                }

            response["temporaries_cleaned"] = bool(temp_root and not temp_root.exists())
            return json.dumps(response)
        except Exception as exc:  # noqa: BLE001 - el estado del job es parte del POC
            safe_error = _safe_error(exc)
            if claimed:
                client.table("requests").update(
                    {"status": "error", "error": safe_error, "finished_at": _now()}
                ).eq("id", request_id).eq("status", "processing").execute()
            return json.dumps(
                {
                    "processed": True,
                    "request_id": request_id,
                    "status": "error",
                    "error": safe_error,
                    "remote_end_to_end_s": time.perf_counter() - started,
                    "gpu_active_s": time.perf_counter() - self.container_entered_at,
                    "temporaries_cleaned": bool(temp_root and not temp_root.exists()),
                    "startup": self.startup,
                }
            )


@app.local_entrypoint()
def main(request_id: str, results_path: str = "") -> None:
    """Invoca una sola vez el request UUID proporcionado explícitamente."""
    request_id = _canonical_request_id(request_id)
    started = time.perf_counter()
    result = json.loads(ExplicitRequestWorker().process.remote(request_id))
    client_roundtrip_s = time.perf_counter() - started
    combined_rate = (
        T4_USD_PER_SECOND
        + CPU_CORES * CPU_USD_PER_CORE_SECOND
        + MEMORY_GIB * MEMORY_USD_PER_GIB_SECOND
    )
    result["client_roundtrip_s"] = client_roundtrip_s
    billed_runtime_s = float(result.get("gpu_active_s", client_roundtrip_s))
    result["estimated_gpu_seconds"] = billed_runtime_s
    result["estimated_cost_usd"] = billed_runtime_s * combined_rate
    destination = Path(results_path) if results_path else RESULT_PATH
    destination.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
