"""Heuristica de asignacion de manos (punto de corte dinamico)."""

from piano_ml.contracts import (
    PianoNote,
    PianoTranscription,
    SourceInfo,
    TranscriptionInfo,
)
from piano_ml.hands import SPLIT_MAX, SPLIT_MIN, assign_hands, split_point_at


def make(notes):
    return PianoTranscription(
        version=1,
        duration=60.0,
        source=SourceInfo(filename="x.mp3"),
        transcription=TranscriptionInfo(engine="test"),
        notes=[
            PianoNote(pitch=p, start=s, end=s + 0.4, velocity=80, hand=None)
            for p, s in notes
        ],
        pedals=[],
    )


class TestSplitPoint:
    def test_sin_notas_cercanas_usa_el_centro(self):
        assert split_point_at([], [], 10.0) == (SPLIT_MIN + SPLIT_MAX) / 2

    def test_mediana_acotada_por_abajo(self):
        # Pieza toda grave: el corte no baja de SPLIT_MIN
        pitches, starts = [30, 32, 34], [1.0, 1.1, 1.2]
        assert split_point_at(pitches, starts, 1.1) == SPLIT_MIN

    def test_mediana_acotada_por_arriba(self):
        pitches, starts = [90, 92, 94], [1.0, 1.1, 1.2]
        assert split_point_at(pitches, starts, 1.1) == SPLIT_MAX


class TestAssignHands:
    def test_acorde_grave_y_melodia_aguda(self):
        # Bajo en C2-E2 (36-40) y melodia en C5-E5 (72-76) simultaneas
        t = assign_hands(make([(36, 0.0), (40, 0.0), (72, 0.0), (76, 0.0)]))
        hands = {n.pitch: n.hand for n in t.notes}
        assert hands[36] == "left" and hands[40] == "left"
        assert hands[72] == "right" and hands[76] == "right"

    def test_pieza_solo_aguda_es_toda_derecha(self):
        t = assign_hands(make([(74, 0.0), (76, 0.5), (79, 1.0), (81, 1.5)]))
        assert all(n.hand == "right" for n in t.notes)

    def test_pieza_solo_grave_es_toda_izquierda(self):
        t = assign_hands(make([(30, 0.0), (33, 0.5), (36, 1.0), (40, 1.5)]))
        assert all(n.hand == "left" for n in t.notes)

    def test_el_corte_sigue_el_registro_en_el_tiempo(self):
        # Primero dos manos separadas; 30s despues todo sube de registro
        early = [(36, 0.0), (72, 0.0), (36, 0.5), (72, 0.5)]
        late = [(60, 30.0), (84, 30.0), (60, 30.5), (84, 30.5)]
        t = assign_hands(make(early + late))
        by_key = {(n.pitch, n.start): n.hand for n in t.notes}
        assert by_key[(36, 0.0)] == "left" and by_key[(72, 0.0)] == "right"
        # En la seccion tardia, 60 queda bajo el corte local (mediana 72->clamp)
        assert by_key[(60, 30.0)] == "left" and by_key[(84, 30.0)] == "right"

    def test_no_muta_la_original(self):
        original = make([(36, 0.0), (72, 0.0)])
        assign_hands(original)
        assert all(n.hand is None for n in original.notes)
