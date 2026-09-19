# Benchmark aislado Modal T4 vs L4

Laboratorio reproducible para medir el pipeline actual con
`El_Carbonero.mp3`. No está conectado a producción y no modifica frontend,
Supabase, cola, Storage, billing ni el contrato de transcripción.

## Estado

Completado el 2026-09-18. Cliente autenticado en el workspace
`waltermejia61`; Volume privado creado, smoke test CPU completado y benchmarks
T4/L4 ejecutados. Modal exigió agregar un método de pago para habilitar GPU aun
con crédito disponible. Tras la prueba quedaron cero contenedores y cero GPUs
activos; no se migró producción.

## Seguridad de costo

- `min_containers=0` y `max_containers=1` por GPU.
- `scaledown_window=2` segundos (mínimo permitido por Modal).
- Una corrida fría y una caliente, secuenciales, por GPU.
- Sin loops ni reintentos automáticos.
- El smoke test previo usa CPU, no GPU.
- El script falla inmediatamente si no coinciden los hashes del audio o del
  checkpoint.

## Activos privados

El audio y el checkpoint están ignorados por Git. Se copian a un Volume
privado de Modal, no al repositorio ni a la imagen:

```powershell
$modal = "benchmarks/modal/.venv/Scripts/modal.exe"
& $modal volume create piano-modal-benchmark-assets
& $modal volume put piano-modal-benchmark-assets `
  data/input/El_Carbonero.mp3 /El_Carbonero.mp3
& $modal volume put piano-modal-benchmark-assets `
  ml/checkpoints/note_F1=0.9677_pedal_F1=0.9186.pth `
  /note_F1=0.9677_pedal_F1=0.9186.pth
```

Hashes esperados:

- Audio: `4FFB99610F58394B77A0C4291AF4C1CE4F45C5193C24C5FD8EBF3DCFEA06D996`
- Checkpoint: `C3FA9730725BF4A762F1C14BC80CD5986EACDA01B026F5A4A2525CD607876141`

## Preparación local

```powershell
py -3.12 -m venv benchmarks/modal/.venv
benchmarks/modal/.venv/Scripts/python.exe -m pip install -r `
  benchmarks/modal/requirements.txt
benchmarks/modal/.venv/Scripts/modal.exe token new
```

## Validación sin GPU

Construye la imagen Linux, valida imports, FFmpeg, el código local y ambos
activos, pero no reserva GPU:

```powershell
benchmarks/modal/.venv/Scripts/modal.exe run `
  benchmarks/modal/smoke_modal.py
```

## Ejecución controlada

Después del smoke test:

```powershell
benchmarks/modal/.venv/Scripts/modal.exe run `
  benchmarks/modal/benchmark_modal.py --gpu all
```

Para aislar una GPU o suprimir la corrida caliente:

```powershell
benchmarks/modal/.venv/Scripts/modal.exe run `
  benchmarks/modal/benchmark_modal.py --gpu T4
benchmarks/modal/.venv/Scripts/modal.exe run `
  benchmarks/modal/benchmark_modal.py --gpu L4 --no-warm
```

El resultado resumido se guarda en `benchmarks/modal/results.json`. No guarda
el audio, el checkpoint ni la transcripción completa.

## Definición de métricas

- **Imports/runtime:** imports pesados dentro del arranque del contenedor.
- **Model load:** construcción del modelo, lectura del checkpoint y traslado a
  CUDA.
- **Preprocessing:** FFmpeg a PCM mono 16 kHz, padding y segmentación.
- **Inference:** exclusivamente el `forward` neural medido entre
  sincronizaciones CUDA.
- **Postprocessing:** deframe, extracción de eventos, normalización, asignación
  de manos y serialización JSON.
- **Total cold:** round-trip de la primera llamada, que incluye scheduling,
  arranque, imports, carga y pipeline.
- **Total warm:** round-trip de la segunda llamada en el mismo contenedor. El
  ID y el índice de llamada verifican la reutilización.
- **Container startup:** valor derivado de `total cold - imports - validación
  de activos - model load - pipeline`; incluye scheduling/RPC no observable
  por separado desde el cliente.

## Entorno Linux fijado

- Debian slim, Python 3.12
- FFmpeg del repositorio Debian de la imagen
- PyTorch 2.11.0
- `piano_transcription_inference==0.0.6`
- NumPy 2.5.2, Pydantic 2.13.5, librosa 1.0.0,
  torchlibrosa 0.1.0, audioread 3.1.0, soundfile 0.14.0, mido 1.3.3,
  matplotlib 3.11.1
- Modal client 1.5.5

No se reutiliza `requirements.lock.txt`, porque contiene el wheel CUDA de
Windows (`torch==2.11.0+cu128`) y dependencias ajenas a este laboratorio.

## Resultados

### Smoke CPU

| Comprobación | Resultado |
|---|---|
| Python | 3.12.10 |
| Código del proyecto | `/root/piano_ml/__init__.py` importado correctamente |
| `piano_transcription_inference` | 0.0.6 |
| FFmpeg | 5.1.9-0+deb12u1 |
| SHA-256 del audio | Correcto |
| SHA-256 del checkpoint | Correcto |
| Round-trip | 6.541 s |
| GPU reservada | Ninguna |

### Benchmark GPU

T4 y L4 completadas el 2026-09-18.

| Métrica | T4 Cold | T4 Warm | L4 Cold | L4 Warm |
|---|---:|---:|---:|---:|
| Container/scheduling startup estimado | 9.328 s | — | 13.484 s | — |
| Imports/runtime | 4.040 s | — | 5.794 s | — |
| Model load | 5.692 s | — | 6.694 s | — |
| Preprocessing | 0.670 s | 0.687 s | 0.711 s | 0.746 s |
| Inferencia neural real | 15.076 s | 14.517 s | 15.722 s | 15.102 s |
| Postprocessing | 0.980 s | 0.969 s | 1.035 s | 0.999 s |
| Pipeline remoto | 16.725 s | 16.174 s | 17.469 s | 16.847 s |
| Total cliente / GPU-seconds estimados | 36.345 s | 16.504 s | 44.231 s | 17.197 s |
| Costo total estimado | $0.00724 | $0.00329 | $0.01137 | $0.00442 |
| Notas | 1,356 | 1,356 | 1,356 | 1,356 |
| Pedales | 217 | 217 | 217 | 217 |
| VRAM pico | 0.297 GiB | 0.297 GiB | 0.297 GiB | 0.297 GiB |

Ambas GPUs reutilizaron el mismo contenedor/modelo para su llamada caliente y
produjeron resultados compatibles con el baseline: duración exacta de 193.608
s, estructura exacta, conteos idénticos y cero eventos descartados.

Para L4, 1,352 notas se emparejaron por pitch y orden temporal con el baseline;
quedaron 4 notas sin pareja en cada lado. Diferencias absolutas: onset máximo
28.190018 s y mediana 0.000015 s; offset máximo 28.239990 s y mediana 0 s;
velocity máximo 41 y mediana 0. Los máximos son conservadores y reflejan el
corrimiento ordinal dentro de los pitches con eventos no emparejados.

En caliente, T4 cuesta aproximadamente $0.00329 por canción y L4 $0.00442:
L4 resulta 34.6% más cara. T4 completa el round-trip 4.0% más rápido que L4.
Capacidad aproximada: 218 canciones/GPU-hour para T4 y 209 para L4.

El billing final de Modal mostró `$0.04` medidos, `$0.04` de créditos aplicados
y `$0.00` facturados. Después de ambas pruebas había cero contenedores/GPU
activos; sólo permanece el Volume privado esperado, cuyo costo observado fue
`$0.00`.

Tarifas de referencia consultadas el 2026-09-18: T4 `$0.000164/s`, L4
`$0.000222/s`, CPU `$0.0000131/core/s` y memoria `$0.00000222/GiB/s`.
