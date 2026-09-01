"""Asignacion heuristica de manos (post-procesamiento, contrato s9).

Metodo: punto de corte dinamico. Para cada nota se calcula la mediana de los
pitches de las notas cercanas en el tiempo (ventana movil); el punto de corte
es esa mediana acotada a un rango central del teclado. Las notas por debajo
van a la izquierda, el resto a la derecha.

Es una heuristica honesta, no un modelo: funciona bien cuando las manos
ocupan registros distintos (el caso comun) y falla con cruces de manos
deliberados. El contrato lista metodos mas avanzados (optimizacion de
secuencias, penalizaciones de cruce) como evolucion futura.
"""

from __future__ import annotations

from bisect import bisect_left, bisect_right
from statistics import median

from .contracts import PianoNote, PianoTranscription

# La mediana movil se acota a este rango para que piezas de una sola mano
# (todo agudo o todo grave) no partan a la mitad su propia mano.
SPLIT_MIN = 48  # C3
SPLIT_MAX = 72  # C5
WINDOW_SECONDS = 1.0


def split_point_at(pitches: list[int], starts: list[float], t: float,
                   window: float = WINDOW_SECONDS) -> float:
    """Punto de corte en el instante t: mediana acotada de la ventana ±window.

    `starts` debe estar ordenado (garantizado por la normalizacion) y alineado
    con `pitches`.
    """
    lo = bisect_left(starts, t - window)
    hi = bisect_right(starts, t + window)
    if lo >= hi:
        return (SPLIT_MIN + SPLIT_MAX) / 2
    m = median(pitches[lo:hi])
    return min(SPLIT_MAX, max(SPLIT_MIN, m))


def assign_hands(transcription: PianoTranscription) -> PianoTranscription:
    """Devuelve una copia de la transcripcion con `hand` asignada en cada nota."""
    notes = transcription.notes
    starts = [n.start for n in notes]
    pitches = [n.pitch for n in notes]

    new_notes = []
    for n in notes:
        split = split_point_at(pitches, starts, n.start)
        hand = "left" if n.pitch < split else "right"
        new_notes.append(PianoNote(pitch=n.pitch, start=n.start, end=n.end,
                                   velocity=n.velocity, hand=hand))

    return transcription.model_copy(update={"notes": new_notes})
