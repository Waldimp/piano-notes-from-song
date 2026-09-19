# Resultado — Modal Worker POC

Fecha: 2026-09-18 (America/El_Salvador)

## Resultado

El POC end-to-end procesó exactamente el request explícito
`19dd7029-759b-4506-95c3-cf4766c71b36` en una NVIDIA T4. No hubo polling ni
claim del job más antiguo. El request terminó en `done`, sin error, asociado a
`El_Carbonero_modal_poc_19dd7029`.

## Evidencia end-to-end

- Archivo: `El_Carbonero.mp3` (3,217,150 bytes).
- Duración: 193.608 s.
- Descarga desde Supabase Storage: 0.955 s.
- Pipeline: 21.138 s.
- Publicación y validación: 2.576 s.
- Tiempo remoto end-to-end: 26.663 s.
- Tiempo de cliente end-to-end: 45.818 s.
- GPU activa estimada: 37.140 GPU-s.
- Imports/runtime: 3.420 s.
- Carga del modelo: 6.555 s.
- Resultado: 1,356 notas, 217 pedales y 0 eventos descartados.
- Contrato `notes.json`: campos exactos, versión, duración y conteos válidos.
- Engine publicado: `high-resolution-piano-transcription`.
- Estado DB: `queued -> processing -> done`; `error=null`.
- Tiempos DB: `started_at=2026-09-19T03:47:03.529638+00:00` y
  `finished_at=2026-09-19T03:47:28.338645+00:00`.
- Temporales: eliminados.
- Postflight: 0 contenedores activos, 0 tareas y todas las apps del POC
  detenidas.

## Idempotencia

El claim fue una actualización condicional por UUID y estado `queued`. El
postflight devolvió `ready=false`, estado `done`, el mismo `song_id` y colisión
del ID determinista. Una nueva ejecución no podría superar las dos barreras
previas al claim (`status != queued` y canción existente). No se realizó una
segunda invocación GPU para demostrarlo.

## Costos observados

Modal reportó para la ejecución exitosa:

| Recurso | Costo |
|---|---:|
| T4 | $0.00622782 |
| CPU | $0.00099856 |
| Memoria | $0.00033778 |
| **Total exitoso** | **$0.00756416** |

Hubo un primer arranque fallido antes de importar el cliente Supabase y antes
del claim, causado por una ruta de mount que no conservaba la estructura del
repositorio. Costó $0.00279833. Un segundo intento fue rechazado localmente por
Modal antes de reservar GPU y no tuvo costo de cómputo reportado. Costo total
observado de esta fase: **$0.01036249**.

Al cerrar el postflight, el workspace mostraba $0.05 de costo medido redondeado,
$0.05345131 en apps efímeras y $0 facturado después de créditos. El reporte por
app atribuye exactamente $0.01036249 a este POC; el resumen también puede
incorporar uso anterior que terminó de consolidarse. Sigue muy por debajo del
umbral de parada de $20.

## Archivos del POC

- `benchmarks/modal/worker_poc.py`
- `benchmarks/modal/preflight_worker_poc.py`
- `benchmarks/modal/configure_worker_secret.py`
- `benchmarks/modal/WORKER_POC_README.md`
- `benchmarks/modal/worker_poc_result.json`
- `benchmarks/modal/requirements.txt`

El worker local y `ml/piano_ml/` no tienen cambios. Sus 49 pruebas pasan.

## Riesgos encontrados

1. El contrato del worker depende de conservar la profundidad del repositorio
   porque `cloud.py` calcula `REPO_ROOT` desde `__file__`; el mount del POC ya
   reproduce `/root/apps/worker/...`.
2. Publicar objetos, upsert de `songs` y actualizar `requests` no es una sola
   transacción. Una migración necesita compensación/limpieza observable ante
   fallos parciales.
3. Todavía no existe un dispatcher de producción que entregue únicamente IDs
   explícitos a Modal, ni un límite de gasto operativo automatizado.
4. El cold start representa una parte relevante de la latencia; no se debe
   cambiar `min_containers=0` sin una decisión explícita de costo.

## Recomendación

**Sí, iniciar el diseño de una migración controlada, pero no activar producción
todavía.** La siguiente fase debe añadir un dispatcher por UUID, compensación
de efectos parciales, observabilidad y guardas de gasto, manteniendo el worker
local como fallback. Este POC no autoriza polling continuo ni tráfico real.
