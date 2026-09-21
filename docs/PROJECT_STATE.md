# Estado del proyecto

Actualizado: 2026-09-21

## Fase actual

**Procesamiento Modal general controlado — implementado y validado.** El camino production-canary se generalizó: nuevas requests `queued` se despachan por UUID explícito desde el control plane hacia Modal T4, sin polling desde Modal.

### Estado operativo

- Migrations 0002–0009 aplicadas en producción (0002–0007 históricas; 0008–0009 general dispatch).
- Modal T4 Environment `production-canary` desplegado (nombre histórico; opera como worker general).
- `worker_control.mode=modal`.
- `kill_switch=false`.
- Dispatcher general activo vía `action=dispatch_next` + wake autenticado.
- 0 GPU/contenedores activos en reposo (`min_containers=0`).
- Worker local disponible como fallback (`mode=local`).
- Hard stop de gasto: USD 20 en ledger.

## Arquitectura actual

- Web Next.js en modo local (FastAPI + SQLite) o nube (Vercel + Supabase).
- Supabase aporta Auth, PostgreSQL, cola `requests`, outbox y Storage privado (`uploads`, `audio`, `notes`).
- Control plane (Edge Function + wake) selecciona un UUID elegible y lo envía a Modal.
- Modal T4 procesa un job a la vez; el worker local permanece como fallback.
- El pipeline genera `notes.json`, MIDI y `playback.m4a`; en nube publica `notes.json` y el audio de reproducción en Supabase.

Detalle operativo: [`MODAL_GENERAL_PROCESSING.md`](MODAL_GENERAL_PROCESSING.md).

## Stack

- Next.js 15, React 19, TypeScript y Canvas 2D.
- Python 3.12, FastAPI, PyTorch 2.11.0 + CUDA 12.8 y FFmpeg.
- `piano_transcription_inference==0.0.6` con High-Resolution Piano Transcription.
- Vercel, Supabase, Modal T4 y SQLite local.

## Estado del producto

MVP funcional con procesamiento cloud automático controlado para beta pequeña. Sigue siendo una aplicación privada/de baja escala.

## Decisiones activas

- Preservar el MVP y escalar por fases pequeñas y reversibles.
- Web/PWA antes que aplicaciones nativas.
- Mantener High-Resolution Piano Transcription como engine principal.
- Modal T4 con despacho explícito por UUID; worker local como fallback.
- No polling cloud desde Modal.
- Mantener Supabase para Auth/DB; R2 y preview gratuito de 60 s siguen como candidatos.

## Último trabajo completado

2026-09-21: procesamiento Modal general habilitado y validado.

Smoke general + 2 jobs adicionales (El Carbonero, 193.608 s):

| Request | Resultado | Notas | Costo observado | GPU-s |
|---|---|---:|---:|---:|
| `9a08febe-…` | done / modal | 1,356 | $0.00944 | 47.4 |
| `9a769feb-…` | done / modal | 1,356 | $0.00617 | 31.0 |
| `b5187e8b-…` | done / modal | 1,356 | $0.00597 | 30.0 |

Net spend ledger ≈ $0.041 (hard stop $20). Prueba de pausa: wake idle y request permaneció `queued`. Estado final: `mode=modal`, `kill_switch=false`.

Deuda no bloqueante: wake por cron (~1 min) en lugar de Database Webhook; naming histórico `dispatch-modal-staging` / `production-canary`; retries automáticos siguen deshabilitados (sí se corrigió reutilización de rutas `cleaned` del mismo request). Requiere `PRODUCTION_CANARY_DISPATCH_WAKE_SECRET` también en Vercel para el cron `/api/dispatch-wake`.

## Siguiente tarea

Mejorar UX/landing y medir uso real en beta. Opcional: Database Webhook/`pg_net` para wake inmediato; renombrar deudas cosméticas cuando no haya riesgo operativo.
