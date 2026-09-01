#!/usr/bin/env python
"""Benchmark tecnico de transcripcion (decision gate post-Fase 2, contrato s26).

Mide por archivo: duracion del audio, tiempo de carga del modelo, tiempo de
inferencia, RAM pico del proceso (RSS), VRAM pico (si CUDA), notas detectadas.

Uso:
    python scripts/benchmark.py data/input/cancion1.mp3 [mas archivos...]
    python scripts/benchmark.py            # usa todos los audios de data/input
"""

from __future__ import annotations

import argparse
import sys
import threading
import time
from pathlib import Path

import psutil

REPO_ROOT = Path(__file__).resolve().parents[1]
AUDIO_EXTS = {".wav", ".mp3", ".m4a", ".flac", ".ogg"}


class PeakRssSampler:
    """Muestrea el RSS del proceso en un hilo para capturar el pico real."""

    def __init__(self, interval: float = 0.1):
        self.process = psutil.Process()
        self.interval = interval
        self.peak = 0
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        while not self._stop.is_set():
            self.peak = max(self.peak, self.process.memory_info().rss)
            time.sleep(self.interval)

    def __enter__(self) -> "PeakRssSampler":
        self._thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self._stop.set()
        self._thread.join()
        self.peak = max(self.peak, self.process.memory_info().rss)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audios", nargs="*", help="Archivos a medir (default: data/input/*)")
    parser.add_argument("--device", default=None, choices=["auto", "cuda", "cpu"])
    args = parser.parse_args()

    files = [Path(a) for a in args.audios] or sorted(
        p for p in (REPO_ROOT / "data" / "input").iterdir()
        if p.suffix.lower() in AUDIO_EXTS
    )
    if not files:
        print("No hay audios que medir (data/input esta vacio).", file=sys.stderr)
        return 1

    import torch

    from piano_ml.engines.high_resolution import HighResolutionEngine
    from piano_ml.pipeline import transcribe_file

    engine = HighResolutionEngine(device=args.device)
    is_cuda = engine.device == "cuda"

    rows = []
    for i, path in enumerate(files):
        if is_cuda:
            torch.cuda.reset_peak_memory_stats()
        with PeakRssSampler() as sampler:
            t0 = time.perf_counter()
            result = transcribe_file(path, engine=engine, output_root=REPO_ROOT / "data" / "output")
            wall = time.perf_counter() - t0
        vram = torch.cuda.max_memory_allocated() / 1e9 if is_cuda else 0.0
        model_load = result.model_load_seconds if i == 0 else 0.0
        infer = wall - (model_load or 0.0)
        rows.append({
            "file": path.name,
            "audio_s": result.audio_duration,
            "model_load_s": model_load or 0.0,
            "infer_s": infer,
            "ratio": result.audio_duration / infer if infer > 0 else 0.0,
            "ram_gb": sampler.peak / 1e9,
            "vram_gb": vram,
            "notes": len(result.transcription.notes),
            "pedals": len(result.transcription.pedals),
        })

    print()
    print(f"Dispositivo: {engine.device} | torch {torch.__version__}")
    header = f"{'archivo':<28} {'audio':>7} {'carga':>6} {'infer':>7} {'x-real':>7} {'RAM-GB':>7} {'VRAM-GB':>8} {'notas':>6} {'pedal':>6}"
    print(header)
    print("-" * len(header))
    for r in rows:
        print(
            f"{r['file']:<28} {r['audio_s']:>6.1f}s {r['model_load_s']:>5.1f}s "
            f"{r['infer_s']:>6.1f}s {r['ratio']:>6.1f}x {r['ram_gb']:>7.2f} "
            f"{r['vram_gb']:>8.2f} {r['notes']:>6} {r['pedals']:>6}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
