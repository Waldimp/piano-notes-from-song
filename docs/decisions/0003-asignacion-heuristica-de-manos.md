# 0003 — Asignación heurística de manos

**Estado:** aceptado (2026-09-01)

## Decisión

La separación izquierda/derecha se hace por post-procesamiento con un **punto
de corte dinámico**: mediana móvil (±1 s) de los pitches, acotada a C3–C5
(`ml/piano_ml/hands.py`). Se aplica automáticamente en el pipeline
(`--no-hands` en el CLI la desactiva) y `scripts/assign_hands.py` recalcula
transcripciones existentes.

## Razones y tradeoff

- El contrato (§9) la pedía como post-procesamiento que no bloqueara las
  fases 1–2 — así fue: llegó después, sin tocar engine ni contrato (el campo
  `hand` ya existía).
- Es una heurística honesta: acierta cuando las manos ocupan registros
  distintos (el caso común) y falla con cruces de manos deliberados.
- Métodos superiores (optimización de secuencias con penalizaciones de cruce
  y rango) quedan como evolución si la práctica real lo exige.
