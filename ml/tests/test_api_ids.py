"""Regresion: validacion de ids de transcripcion en el API.

Bug original: _output_dir_for re-aplicaba _safe_stem al id, y Path.stem
cortaba en el primer punto interior del nombre (archivos tipo
"Y2Mate.is - cancion.mp3" -> id con punto -> 400 al pedir sus notas).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps" / "api"))

from app.main import _is_safe_id, _safe_stem  # noqa: E402


class TestSafeStem:
    def test_nombre_con_puntos_y_acentos(self):
        stem = _safe_stem("Y2Mate.is - Vídeo _El carbonero_ Hernández.mp3")
        assert stem == "Y2Mate.is_-_V_deo__El_carbonero__Hern_ndez"

    def test_todo_stem_generado_es_id_valido(self):
        for name in [
            "Y2Mate.is - Vídeo _El carbonero_ Hernández.mp3",
            "canción con espacios.wav",
            "ya_limpio.flac",
            "...raro....mp3",
            "áéíóú.mp3",
        ]:
            assert _is_safe_id(_safe_stem(name)), name


class TestIsSafeId:
    def test_ids_validos(self):
        assert _is_safe_id("cut_liszt")
        assert _is_safe_id("Y2Mate.is_-_V_deo__El_carbonero")
        assert _is_safe_id("a.b.c-d_e")

    def test_ids_peligrosos_rechazados(self):
        assert not _is_safe_id("..")
        assert not _is_safe_id("../otro")
        assert not _is_safe_id("a/../b")
        assert not _is_safe_id(".oculto")
        assert not _is_safe_id("con espacios")
        assert not _is_safe_id("")
        assert not _is_safe_id("a\b")
