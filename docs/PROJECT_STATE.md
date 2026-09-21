# Estado del proyecto

Actualizado: 2026-09-21

## Fase actual

**Procesamiento Modal general controlado — implementado y validado.** El camino production-canary se generalizó: nuevas requests `queued` se despachan por UUID explícito desde el control plane hacia Modal T4, sin polling desde Modal.

### Estado operativo

- Migrations 0002–0010 aplicadas en producción (0002–0007 históricas; 0008–0009 general dispatch; 0010 restore INSERT policy web).
- Modal T4 Environment `production-canary` desplegado (nombre histórico; opera como worker general).
- `worker_control.mode=modal`.
- `kill_switch=false`.
- Wake primario: tras `INSERT requests` la web llama `POST /api/wake-dispatch` (sesión autenticada; secret solo en servidor) → `dispatch_next`.
- Recovery: cron Hobby diario `GET/POST /api/dispatch-wake` (`CRON_SECRET`).
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

2026-09-21: wake inmediato post-upload (sin Pro / sin Webhook).

- Camino primario: `submitAudio` (browser INSERT) → `POST /api/wake-dispatch` (JWT de sesión; secret solo en servidor) → `dispatch_next` → Modal.
- Recovery: cron Hobby `5 12 * * *` en `/api/dispatch-wake`.
- El wake es best-effort: si falla, la request permanece `queued`.
- Fix 0010: policy `requests: crear autenticados` restaurada a `requested_by = auth.uid()` (estaba `WITH CHECK (false)`).
- E2E: `6706951e-…` (~26 s a processing) y `f9991683-…` (~7 s) → done; outbox closed; leases=0; `_staging=0`; GPU=0; net spend ≈ $0.072.
- Modal sigue sin polling. `mode=modal`, `kill_switch=false`.

## Siguiente tarea

Mejorar UX/landing y medir uso real en beta. Opcional: rate limiting del wake en Beta Readiness; renombrar deudas cosméticas.
