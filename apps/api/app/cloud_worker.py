"""Panel local de la cola en la nube: "Procesar ahora" y "Escuchar mientras el
backend este abierto". Reutiliza el modelo ya cargado por el API y el mismo
lock de GPU que los jobs locales, asi nada se pisa.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import deque
from datetime import datetime

logger = logging.getLogger("piano.cloud")

LOG_LINES = 60
LISTEN_INTERVAL = 15.0


def _stamp(msg: str) -> str:
    return f"{datetime.now():%H:%M:%S} {msg}"


class _DequeHandler(logging.Handler):
    """Copia los logs del worker/pipeline a una cola en memoria para la UI."""

    def __init__(self, sink: deque):
        super().__init__(level=logging.INFO)
        self.sink = sink

    def emit(self, record: logging.LogRecord) -> None:
        self.sink.append(_stamp(record.getMessage()))


class CloudWorkerPanel:
    def __init__(self, engine, run_lock: threading.Lock):
        self.engine = engine
        self.run_lock = run_lock
        self.log: deque[str] = deque(maxlen=LOG_LINES)
        self.running = False
        self.listening = False
        self.processed_total = 0
        self.last_run: str | None = None
        self.last_error: str | None = None
        self._state_lock = threading.Lock()
        self._stop = threading.Event()

        handler = _DequeHandler(self.log)
        for name in ("piano.worker", "piano_ml.pipeline"):
            logging.getLogger(name).addHandler(handler)

    # ---- consultas ----
    def list_requests(self) -> list[dict]:
        from piano_worker.cloud import get_client

        return (
            get_client()
            .table("requests")
            .select("id,filename,status,error,created_at,started_at,finished_at,song_id")
            .order("created_at", desc=True)
            .limit(30)
            .execute()
            .data
        )

    def status(self) -> dict:
        return {
            "running": self.running,
            "listening": self.listening,
            "processedTotal": self.processed_total,
            "lastRun": self.last_run,
            "lastError": self.last_error,
            "log": list(self.log),
        }

    # ---- acciones ----
    def process_now(self) -> bool:
        """Lanza un vaciado de la cola en segundo plano. False si ya hay uno."""
        with self._state_lock:
            if self.running:
                return False
            self.running = True
        threading.Thread(target=self._drain, name="cloud-drain", daemon=True).start()
        return True

    def set_listening(self, enabled: bool) -> None:
        with self._state_lock:
            if enabled and not self.listening:
                self.listening = True
                self._stop.clear()
                threading.Thread(target=self._listen_loop, name="cloud-listen", daemon=True).start()
                self.log.append(_stamp(f"Escuchando la cola cada {LISTEN_INTERVAL:.0f}s"))
            elif not enabled and self.listening:
                self.listening = False
                self._stop.set()
                self.log.append(_stamp("Escucha detenida"))

    # ---- internos ----
    def _drain(self) -> None:
        from piano_worker.cloud import get_client
        from piano_worker.worker import drain_queue

        try:
            with self.run_lock:  # no pisar una transcripcion local en curso
                n = drain_queue(get_client(), self.engine)
            self.processed_total += n
            self.last_error = None
            if n == 0:
                self.log.append(_stamp("Cola vacia"))
        except Exception as exc:  # noqa: BLE001 — se muestra en el panel
            self.last_error = str(exc)
            logger.exception("Fallo procesando la cola")
            self.log.append(_stamp(f"ERROR: {exc}"))
        finally:
            self.last_run = datetime.now().isoformat(timespec="seconds")
            with self._state_lock:
                self.running = False

    def _listen_loop(self) -> None:
        # Primera pasada inmediata, luego cada LISTEN_INTERVAL segundos.
        while not self._stop.is_set():
            if not self.running and self.process_now():
                while self.running and not self._stop.is_set():
                    time.sleep(1)
            if self._stop.wait(LISTEN_INTERVAL):
                break
