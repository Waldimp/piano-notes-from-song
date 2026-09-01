# Benchmarks — decision gate post-Fase 2 (contrato §26)

## Mediciones técnicas (2026-09-01)

Máquina: Windows 11, NVIDIA RTX PRO 2000 (8 GB), Python 3.12, torch 2.11.0+cu128.
Reproducir con: `.venv\Scripts\python scripts\benchmark.py <audios...>`

| Archivo | Audio | Carga modelo | Inferencia | Velocidad | RAM pico | VRAM pico | Notas |
|---|---|---|---|---|---|---|---|
| cut_liszt.mp3 | 40 s | 6.1 s | ~8 s | ~5x t.real | — | — | 510 |
| liszt_6min.mp3 (sintético, 9× concat) | 360.5 s | 18.8 s | 56.4 s | 6.4x t.real | 1.79 GB | 0.36 GB | 4610 |

### Frontend (tutorial con 4610 notas)

| Métrica | Resultado |
|---|---|
| FPS reproduciendo pasaje denso | 60 (estable, cap del monitor) |
| Barrido de 50 seeks por toda la pieza | ~1.05 s total, sin bloqueos |

### Conclusiones técnicas

- Una canción de 3–5 min transcribe en ~30–60 s en GPU: el endpoint síncrono es
  incómodo para el navegador → justifica la Fase 4 lite (jobs en background).
- RAM (1.8 GB) y VRAM (0.4 GB) son modestas: cualquier decisión de deployment
  futuro es viable, incluido un worker local permanente.
- El renderer con ventana binaria mantiene 60 FPS: no se necesita WebGL.

## Calidad de transcripción (§7) — PENDIENTE: llenar escuchando

Transcribe tus piezas (`python scripts/transcribe.py data/input/<pieza>`), abre el
tutorial y el MIDI, y anota. Si algo sale inaceptable, se compara Basic Pitch con
los mismos archivos antes de cambiar nada.

| Prueba | Notas correctas | Notas falsas | Timing | Acordes | Pedal | General |
|---|---|---|---|---|---|---|
| Pieza lenta simple | | | | | | |
| Acordes densos | | | | | | |
| Pasaje rápido | | | | | | |
| Pedal sostenido | | | | | | |
| Piano digital | | | | | | |
| Piano acústico | | | | | | |
| Audio de estudio | | | | | | |
| Grabación de celular | | | | | | |
