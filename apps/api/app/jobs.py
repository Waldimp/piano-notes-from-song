"""Jobs de transcripcion en background — version minima local-first.

Sin Redis/Celery/colas (contrato s15): los jobs viven en memoria del proceso
y se ejecutan con BackgroundTasks de FastAPI. Un lock global serializa las
transcripciones (una GPU, un modelo). Si el proceso se reinicia, los jobs en
memoria se pierden, pero las transcripciones terminadas ya estan en disco.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger("piano.jobs")


@dataclass
class Job:
    id: str
    filename: str
    status: str = "queued"  # queued | processing | done | error
    transcription_id: Optional[str] = None
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    stats: Optional[dict] = None

    def to_public(self) -> dict:
        d = asdict(self)
        d["queuePosition"] = None
        return d


class JobStore:
    """Registro en memoria + lock que serializa la ejecucion de modelos."""

    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._registry_lock = threading.Lock()
        self.run_lock = threading.Lock()  # una transcripcion a la vez

    def create(self, filename: str) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], filename=filename)
        with self._registry_lock:
            self._jobs[job.id] = job
        return job

    def get(self, job_id: str) -> Optional[Job]:
        with self._registry_lock:
            return self._jobs.get(job_id)

    def queue_position(self, job_id: str) -> Optional[int]:
        """Posicion 1-based entre los jobs aun no terminados, por antiguedad."""
        with self._registry_lock:
            pending = sorted(
                (j for j in self._jobs.values() if j.status in ("queued", "processing")),
                key=lambda j: j.created_at,
            )
        for i, j in enumerate(pending, start=1):
            if j.id == job_id:
                return i
        return None


def run_transcription_job(store: JobStore, job: Job, audio_path: Path, output_dir: Path, engine) -> None:
    """Cuerpo del background task: transcribe y actualiza el estado del job."""
    from piano_ml.pipeline import transcribe_file

    with store.run_lock:
        job.status = "processing"
        job.started_at = time.time()
        try:
            result = transcribe_file(audio_path, engine=engine, output_root=output_dir)
            job.transcription_id = audio_path.stem
            job.stats = {
                "audioDuration": result.audio_duration,
                "processingSeconds": result.processing_seconds,
                "noteCount": len(result.transcription.notes),
                "pedalCount": len(result.transcription.pedals),
                "engine": result.engine,
            }
            from . import library

            library.upsert_song(audio_path.stem, result.notes_path)
            job.status = "done"
        except Exception as exc:  # noqa: BLE001 — el estado del job ES el manejo
            logger.exception("Job %s fallo", job.id)
            job.error = str(exc)
            job.status = "error"
        finally:
            job.finished_at = time.time()
