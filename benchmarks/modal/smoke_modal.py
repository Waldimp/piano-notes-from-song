"""Smoke test exclusivamente CPU para la imagen y los activos de Modal."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import subprocess
import sys
import time
from pathlib import Path

import modal


VOLUME_NAME = "piano-modal-benchmark-assets"
REMOTE_ASSETS = Path("/assets")
REMOTE_AUDIO = REMOTE_ASSETS / "El_Carbonero.mp3"
REMOTE_CHECKPOINT = REMOTE_ASSETS / "note_F1=0.9677_pedal_F1=0.9186.pth"
AUDIO_SHA256 = "4FFB99610F58394B77A0C4291AF4C1CE4F45C5193C24C5FD8EBF3DCFEA06D996"
CHECKPOINT_SHA256 = "C3FA9730725BF4A762F1C14BC80CD5986EACDA01B026F5A4A2525CD607876141"
REPO_ROOT = Path(__file__).resolve().parents[2] if modal.is_local() else Path("/root")

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
)
if modal.is_local():
    image = image.add_local_dir(
        REPO_ROOT / "ml" / "piano_ml", remote_path="/root/piano_ml"
    )

assets = modal.Volume.from_name(VOLUME_NAME, create_if_missing=False)
app = modal.App("piano-modal-benchmark-smoke", image=image)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


@app.function(
    volumes={str(REMOTE_ASSETS): assets},
    cpu=0.125,
    memory=512,
    timeout=120,
)
def smoke() -> dict[str, object]:
    import piano_ml

    result = {
        "python": sys.version.split()[0],
        "modal_code_import": piano_ml.__file__,
        "piano_transcription_inference": importlib.metadata.version(
            "piano-transcription-inference"
        ),
        "audio_sha256": _sha256(REMOTE_AUDIO),
        "checkpoint_sha256": _sha256(REMOTE_CHECKPOINT),
        "ffmpeg": subprocess.run(
            ["ffmpeg", "-version"], capture_output=True, text=True, check=True
        ).stdout.splitlines()[0],
    }
    if result["audio_sha256"] != AUDIO_SHA256:
        raise RuntimeError("El SHA-256 del audio remoto no coincide.")
    if result["checkpoint_sha256"] != CHECKPOINT_SHA256:
        raise RuntimeError("El SHA-256 del checkpoint remoto no coincide.")
    return result


@app.local_entrypoint()
def main() -> None:
    started = time.perf_counter()
    result = smoke.remote()
    result["client_roundtrip_s"] = time.perf_counter() - started
    print(json.dumps(result, indent=2))
