"""Benchmark aislado de High-Resolution Piano Transcription en Modal.

El script no se integra con produccion. Usa un Volume privado para el audio y
el checkpoint, y ejecuta como maximo una corrida fria y una caliente por GPU.
"""

from __future__ import annotations

import hashlib
import json
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import modal


APP_NAME = "piano-modal-benchmark"
VOLUME_NAME = "piano-modal-benchmark-assets"
REMOTE_ASSETS = Path("/assets")
REMOTE_AUDIO = REMOTE_ASSETS / "El_Carbonero.mp3"
REMOTE_CHECKPOINT = REMOTE_ASSETS / "note_F1=0.9677_pedal_F1=0.9186.pth"

AUDIO_SHA256 = "4FFB99610F58394B77A0C4291AF4C1CE4F45C5193C24C5FD8EBF3DCFEA06D996"
CHECKPOINT_SHA256 = "C3FA9730725BF4A762F1C14BC80CD5986EACDA01B026F5A4A2525CD607876141"
EXPECTED_AUDIO_SECONDS = 193.608
EXPECTED_NOTES = 1356
EXPECTED_PEDALS = 217

# Tarifas publicadas por Modal consultadas el 2026-09-18.
GPU_USD_PER_SECOND = {"T4": 0.000164, "L4": 0.000222}
CPU_USD_PER_CORE_SECOND = 0.0000131
MEMORY_USD_PER_GIB_SECOND = 0.00000222
REQUESTED_CPU_CORES = 2.0
REQUESTED_MEMORY_GIB = 4.0

if modal.is_local():
    REPO_ROOT = Path(__file__).resolve().parents[2]
    BASELINE_PATH = REPO_ROOT / "data" / "output" / "El_Carbonero" / "notes.json"
    DEFAULT_RESULTS_PATH = Path(__file__).with_name("results.json")
else:
    REPO_ROOT = Path("/root")
    BASELINE_PATH = Path("/dev/null")
    DEFAULT_RESULTS_PATH = Path("/tmp/results.json")

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
app = modal.App(APP_NAME, image=image)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def _container_enter(instance: Any, requested_gpu: str) -> None:
    enter_started = time.perf_counter()

    imports_started = time.perf_counter()
    import importlib.metadata

    import numpy as np
    import torch
    from piano_ml.engines.base import RawTranscription
    from piano_ml.engines.high_resolution import HighResolutionEngine
    from piano_ml.hands import assign_hands
    from piano_ml.normalize import NormalizationReport, normalize_raw
    from piano_ml.preprocessing.audio import audio_duration_seconds, load_audio_mono
    from piano_transcription_inference import sample_rate
    from piano_transcription_inference.pytorch_utils import forward
    from piano_transcription_inference.utilities import RegressionPostProcessor

    imports_s = time.perf_counter() - imports_started

    asset_started = time.perf_counter()
    if _sha256(REMOTE_AUDIO) != AUDIO_SHA256:
        raise RuntimeError("El SHA-256 del audio remoto no coincide.")
    if _sha256(REMOTE_CHECKPOINT) != CHECKPOINT_SHA256:
        raise RuntimeError("El SHA-256 del checkpoint remoto no coincide.")
    asset_validation_s = time.perf_counter() - asset_started

    engine = HighResolutionEngine(checkpoint_path=REMOTE_CHECKPOINT, device="cuda")
    engine._ensure_model()
    torch.cuda.synchronize()

    instance.requested_gpu = requested_gpu
    instance.engine = engine
    instance.torch = torch
    instance.np = np
    instance.RawTranscription = RawTranscription
    instance.NormalizationReport = NormalizationReport
    instance.normalize_raw = normalize_raw
    instance.assign_hands = assign_hands
    instance.load_audio_mono = load_audio_mono
    instance.audio_duration_seconds = audio_duration_seconds
    instance.sample_rate = sample_rate
    instance.forward = forward
    instance.RegressionPostProcessor = RegressionPostProcessor
    instance.call_index = 0
    instance.container_id = socket.gethostname()
    instance.init = {
        "imports_runtime_s": imports_s,
        "asset_validation_s": asset_validation_s,
        "model_load_s": float(engine.model_load_seconds or 0.0),
        "container_initialization_s": time.perf_counter() - enter_started,
        "gpu_requested": requested_gpu,
        "gpu_actual": torch.cuda.get_device_name(0),
        "cuda_runtime": torch.version.cuda,
        "torch": str(torch.__version__),
        "python": sys.version.split()[0],
        "piano_transcription_inference": importlib.metadata.version(
            "piano-transcription-inference"
        ),
        "ffmpeg": subprocess.run(
            ["ffmpeg", "-version"], capture_output=True, text=True, check=True
        ).stdout.splitlines()[0],
        "audio_sha256": AUDIO_SHA256,
        "checkpoint_sha256": CHECKPOINT_SHA256,
    }


def _run_once(instance: Any) -> dict[str, Any]:
    """Mide decode, forward neural y postproceso como fases independientes."""
    total_started = time.perf_counter()
    instance.call_index += 1
    torch = instance.torch

    preprocess_started = time.perf_counter()
    audio = instance.load_audio_mono(REMOTE_AUDIO, instance.sample_rate)
    audio_duration = instance.audio_duration_seconds(audio, instance.sample_rate)
    audio_2d = audio[None, :]
    audio_len = audio_2d.shape[1]
    segment_samples = instance.engine._transcriptor.segment_samples
    pad_len = int(instance.np.ceil(audio_len / segment_samples)) * segment_samples - audio_len
    audio_padded = instance.np.concatenate(
        (audio_2d, instance.np.zeros((1, pad_len), dtype=audio_2d.dtype)), axis=1
    )
    segments = instance.engine._transcriptor.enframe(audio_padded, segment_samples)
    preprocessing_s = time.perf_counter() - preprocess_started

    torch.cuda.reset_peak_memory_stats()
    torch.cuda.synchronize()
    inference_started = time.perf_counter()
    output_dict = instance.forward(instance.engine._transcriptor.model, segments, batch_size=1)
    torch.cuda.synchronize()
    inference_s = time.perf_counter() - inference_started
    peak_vram_gib = torch.cuda.max_memory_allocated() / (1024**3)

    postprocess_started = time.perf_counter()
    for key in output_dict:
        output_dict[key] = instance.engine._transcriptor.deframe(output_dict[key])[:audio_len]
    transcriptor = instance.engine._transcriptor
    post_processor = instance.RegressionPostProcessor(
        transcriptor.frames_per_second,
        classes_num=transcriptor.classes_num,
        onset_threshold=transcriptor.onset_threshold,
        offset_threshold=transcriptor.offset_threshod,
        frame_threshold=transcriptor.frame_threshold,
        pedal_offset_threshold=transcriptor.pedal_offset_threshold,
    )
    note_events, pedal_events = post_processor.output_dict_to_midi_events(output_dict)
    raw = instance.RawTranscription(
        engine="high-resolution-piano-transcription",
        duration=audio_duration,
        note_events=note_events or [],
        pedal_events=pedal_events or [],
    )
    report = instance.NormalizationReport()
    transcription = instance.normalize_raw(raw, filename=REMOTE_AUDIO.name, report=report)
    transcription = instance.assign_hands(transcription)
    transcription_dict = transcription.model_dump()
    canonical = json.dumps(transcription_dict, sort_keys=True, separators=(",", ":"))
    postprocessing_s = time.perf_counter() - postprocess_started

    return {
        "container_id": instance.container_id,
        "container_call_index": instance.call_index,
        "init": instance.init,
        "audio_s": audio_duration,
        "preprocessing_s": preprocessing_s,
        "inference_s": inference_s,
        "postprocessing_s": postprocessing_s,
        "remote_pipeline_s": time.perf_counter() - total_started,
        "notes": len(transcription.notes),
        "pedals": len(transcription.pedals),
        "dropped_events": len(report.dropped),
        "peak_vram_gib": peak_vram_gib,
        "transcription_sha256": hashlib.sha256(canonical.encode("utf-8")).hexdigest().upper(),
        "transcription": transcription_dict,
    }


COMMON_RESOURCES = {
    "image": image,
    "volumes": {str(REMOTE_ASSETS): assets},
    "cpu": REQUESTED_CPU_CORES,
    "memory": int(REQUESTED_MEMORY_GIB * 1024),
    "timeout": 10 * 60,
    "min_containers": 0,
    "max_containers": 1,
    "scaledown_window": 2,
}


@app.cls(gpu="T4", **COMMON_RESOURCES)
class T4Benchmark:
    @modal.enter()
    def enter(self) -> None:
        _container_enter(self, "T4")

    @modal.method()
    def run(self) -> str:
        return json.dumps(_run_once(self))


@app.cls(gpu="L4", **COMMON_RESOURCES)
class L4Benchmark:
    @modal.enter()
    def enter(self) -> None:
        _container_enter(self, "L4")

    @modal.method()
    def run(self) -> str:
        return json.dumps(_run_once(self))


def _compare_transcriptions(actual: dict[str, Any], baseline: dict[str, Any]) -> dict[str, Any]:
    from collections import defaultdict
    from statistics import median

    required = {"version", "duration", "source", "transcription", "notes", "pedals"}
    actual_notes = actual.get("notes", [])
    baseline_notes = baseline.get("notes", [])
    actual_pedals = actual.get("pedals", [])
    baseline_pedals = baseline.get("pedals", [])

    aligned_notes = len(actual_notes) == len(baseline_notes) and all(
        left.get("pitch") == right.get("pitch")
        for left, right in zip(actual_notes, baseline_notes)
    )
    note_time_max_abs_s = None
    if aligned_notes and actual_notes:
        note_time_max_abs_s = max(
            max(abs(float(left[k]) - float(right[k])) for k in ("start", "end"))
            for left, right in zip(actual_notes, baseline_notes)
        )

    aligned_pedals = len(actual_pedals) == len(baseline_pedals)
    pedal_time_max_abs_s = None
    if aligned_pedals and actual_pedals:
        pedal_time_max_abs_s = max(
            max(abs(float(left[k]) - float(right[k])) for k in ("start", "end"))
            for left, right in zip(actual_pedals, baseline_pedals)
        )

    # Empareja notas del mismo pitch por orden temporal. Las diferencias se
    # reportan en valor absoluto para no ocultar desviaciones que se cancelen.
    actual_by_pitch: dict[int, list[dict[str, Any]]] = defaultdict(list)
    baseline_by_pitch: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for note in actual_notes:
        actual_by_pitch[int(note["pitch"])].append(note)
    for note in baseline_notes:
        baseline_by_pitch[int(note["pitch"])].append(note)

    onset_deltas: list[float] = []
    offset_deltas: list[float] = []
    velocity_deltas: list[float] = []
    for pitch in sorted(set(actual_by_pitch) & set(baseline_by_pitch)):
        left_notes = sorted(actual_by_pitch[pitch], key=lambda note: float(note["start"]))
        right_notes = sorted(baseline_by_pitch[pitch], key=lambda note: float(note["start"]))
        for left, right in zip(left_notes, right_notes):
            onset_deltas.append(abs(float(left["start"]) - float(right["start"])))
            offset_deltas.append(abs(float(left["end"]) - float(right["end"])))
            velocity_deltas.append(abs(float(left["velocity"]) - float(right["velocity"])))

    def delta_stats(values: list[float]) -> dict[str, float | None]:
        return {
            "max": max(values) if values else None,
            "median": median(values) if values else None,
        }

    duration_delta = abs(float(actual.get("duration", 0)) - float(baseline["duration"]))
    compatible = (
        set(actual) == required
        and actual.get("version") == baseline.get("version") == 1
        and actual.get("transcription", {}).get("engine")
        == baseline.get("transcription", {}).get("engine")
        and duration_delta <= 0.01
        and abs(len(actual_notes) - len(baseline_notes)) <= max(1, round(len(baseline_notes) * 0.01))
        and abs(len(actual_pedals) - len(baseline_pedals)) <= max(2, round(len(baseline_pedals) * 0.02))
    )
    return {
        "compatible": compatible,
        "structure_exact": set(actual) == required,
        "duration_delta_s": duration_delta,
        "notes_delta": len(actual_notes) - len(baseline_notes),
        "pedals_delta": len(actual_pedals) - len(baseline_pedals),
        "note_pitch_sequence_exact": aligned_notes,
        "note_time_max_abs_s": note_time_max_abs_s,
        "pedal_sequence_aligned": aligned_pedals,
        "pedal_time_max_abs_s": pedal_time_max_abs_s,
        "matched_notes_same_pitch": len(onset_deltas),
        "unmatched_actual_notes": len(actual_notes) - len(onset_deltas),
        "unmatched_baseline_notes": len(baseline_notes) - len(onset_deltas),
        "onset_abs_delta_s": delta_stats(onset_deltas),
        "offset_abs_delta_s": delta_stats(offset_deltas),
        "velocity_abs_delta": delta_stats(velocity_deltas),
    }


def _invoke_gpu(gpu: str, include_warm: bool) -> dict[str, Any]:
    runner = T4Benchmark() if gpu == "T4" else L4Benchmark()
    calls: list[dict[str, Any]] = []
    count = 2 if include_warm else 1
    for label in ("cold", "warm")[:count]:
        client_started = time.perf_counter()
        result = json.loads(runner.run.remote())
        result["client_roundtrip_s"] = time.perf_counter() - client_started
        result["label"] = label
        calls.append(result)

    cold = calls[0]
    init = cold["init"]
    measured_inside = (
        init["imports_runtime_s"]
        + init["asset_validation_s"]
        + init["model_load_s"]
        + cold["remote_pipeline_s"]
    )
    cold["container_startup_estimate_s"] = max(0.0, cold["client_roundtrip_s"] - measured_inside)

    warm_reused = len(calls) == 2 and (
        calls[1]["container_id"] == cold["container_id"]
        and calls[1]["container_call_index"] == 2
    )
    priced_seconds = sum(call["client_roundtrip_s"] for call in calls)
    gpu_cost = priced_seconds * GPU_USD_PER_SECOND[gpu]
    combined_rate = (
        GPU_USD_PER_SECOND[gpu]
        + REQUESTED_CPU_CORES * CPU_USD_PER_CORE_SECOND
        + REQUESTED_MEMORY_GIB * MEMORY_USD_PER_GIB_SECOND
    )
    warm_seconds = calls[-1]["client_roundtrip_s"] if warm_reused else None

    return {
        "gpu": gpu,
        "calls": calls,
        "warm_container_reused": warm_reused,
        "estimated_billable_seconds": priced_seconds,
        "estimated_gpu_cost_usd": gpu_cost,
        "estimated_total_resource_cost_usd": priced_seconds * combined_rate,
        "estimated_warm_cost_per_song_usd": (
            warm_seconds * combined_rate if warm_seconds is not None else None
        ),
    }


@app.local_entrypoint()
def main(
    gpu: str = "all",
    warm: bool = True,
    results_path: str = "",
) -> None:
    """Ejecuta el benchmark T4/L4 sin reintentos automaticos."""
    selected = gpu.upper()
    if selected not in {"ALL", "T4", "L4"}:
        raise ValueError("--gpu debe ser all, T4 o L4")

    baseline = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    gpu_names = ["T4", "L4"] if selected == "ALL" else [selected]
    runs = []
    for gpu_name in gpu_names:
        run = _invoke_gpu(gpu_name, include_warm=warm)
        for call in run["calls"]:
            call["validation"] = _compare_transcriptions(call["transcription"], baseline)
            del call["transcription"]
        runs.append(run)
        print(json.dumps(run, indent=2))

    report = {
        "benchmark": APP_NAME,
        "created_at_unix": time.time(),
        "baseline": {
            "audio_s": baseline["duration"],
            "notes": len(baseline["notes"]),
            "pedals": len(baseline["pedals"]),
            "audio_sha256": AUDIO_SHA256,
            "checkpoint_sha256": CHECKPOINT_SHA256,
        },
        "runs": runs,
        "estimated_lab_cost_usd": sum(
            item["estimated_total_resource_cost_usd"] for item in runs
        ),
        "cost_method": (
            "Estimacion conservadora: suma del round-trip cliente de cada llamada por "
            "las tarifas publicadas de GPU, 2 CPU cores y 4 GiB de memoria. No incluye "
            "un cargo observado del dashboard de Modal."
        ),
    }
    destination = Path(results_path) if results_path else DEFAULT_RESULTS_PATH
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Resultados guardados en: {destination}")
