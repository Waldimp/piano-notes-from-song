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

## Modal T4 vs L4 (2026-09-18)

Laboratorio aislado y reproducible en [`benchmarks/modal/`](../benchmarks/modal/README.md). Audio: `El_Carbonero.mp3`, 193.608 s, con el mismo checkpoint y pipeline en ambas GPUs.

| Métrica | T4 Cold | T4 Warm | L4 Cold | L4 Warm |
|---|---:|---:|---:|---:|
| Inicio contenedor/scheduling | 9.328 s | — | 13.484 s | — |
| Carga del modelo | 5.692 s | — | 6.694 s | — |
| Inferencia neural | 15.076 s | 14.517 s | 15.722 s | 15.102 s |
| Total cliente | 36.345 s | 16.504 s | 44.231 s | 17.197 s |
| Costo estimado | $0.00724 | $0.00329 | $0.01137 | $0.00442 |
| Notas / pedales | 1,356 / 217 | 1,356 / 217 | 1,356 / 217 | 1,356 / 217 |
| VRAM pico | 0.297 GiB | 0.297 GiB | 0.297 GiB | 0.297 GiB |

Ambas GPUs conservaron duración, estructura, conteos y cero eventos descartados. La salida no fue idéntica byte a byte al baseline local: en L4 se emparejaron 1,352 notas por pitch y orden temporal, con medianas de diferencia de 0.000015 s en onset, 0 s en offset y 0 en velocity. Los máximos quedan distorsionados por cuatro notas sin pareja en cada lado.

**Decisión:** T4 para la prueba inicial del worker cloud. En caliente fue 34.6% más barata y aproximadamente 4.0% más rápida que L4. Modal continúa; RunPod queda como fallback y producción todavía no se migra.

## Modal Worker POC end-to-end (2026-09-18)

Evidencia completa en [`WORKER_POC_RESULT.md`](../benchmarks/modal/WORKER_POC_RESULT.md). Se despachó únicamente el request explícito `19dd7029-759b-4506-95c3-cf4766c71b36`; no hubo polling ni cambios en el worker local.

| Métrica | Resultado |
|---|---:|
| Estado | `queued -> processing -> done` |
| Song ID | `El_Carbonero_modal_poc_19dd7029` |
| Duración | 193.608 s |
| Notas / pedales | 1,356 / 217 |
| Eventos descartados | 0 |
| Tiempo remoto | 26.663 s |
| Round-trip cliente | 45.818 s |
| GPU activa | 37.140 s |
| Costo exitoso observado | $0.00756416 |
| Costo total con arranque fallido previo al claim | $0.01036249 |

El primer arranque falló por una ruta de montaje incorrecta antes de acceder a Supabase; el request permaneció `queued`. Tras corregir únicamente el montaje aislado, el POC publicó un contrato válido, eliminó temporales y terminó con cero GPUs/contenedores activos. El resultado autoriza diseñar una migración controlada, no activar producción.
