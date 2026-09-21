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

2026-09-21: activación Modal general **cerrada** en producción.

- `PRODUCTION_CANARY_DISPATCH_WAKE_SECRET` configurado en Vercel (Production + Preview).
- Cron productivo: `GET/POST /api/dispatch-wake` (auth `CRON_SECRET` → Edge `dispatch_next`). En Hobby el schedule es `5 12 * * *` (1×/día; Vercel bloquea `* * * * *`).
- E2E vía ruta wake: `48de152d-…` y `dd9cfaea-…` → `queued` → `processing` → `done` (Modal, 1 song c/u, 1,356 notas). Segundo wake concurrente → `idle` / sin doble dispatch.
- Estado final: `mode=modal`, `kill_switch=false`, outbox `closed`, leases=0, `_staging=0`, GPU/containers=0, net spend ledger ≈ $0.054 (hard stop $20).

Deuda no bloqueante: wake no es near-realtime en Hobby (cron diario) ni Database Webhook/`pg_net`; naming histórico `dispatch-modal-staging` / `production-canary`; retries automáticos deshabilitados.

## Siguiente tarea

Mejorar UX/landing y medir uso real en beta. Opcional: Pro (cron frecuente) o Database Webhook/`pg_net` para wake inmediato; renombrar deudas cosméticas cuando no haya riesgo operativo.
