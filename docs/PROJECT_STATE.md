# Estado del proyecto

Actualizado: 2026-09-21

## Fase actual

**Beta Readiness — aislamiento + créditos + límites (sin pagos).** El procesamiento Modal general permanece; se añadió ownership RLS, entitlements, ledger de créditos de usuario y create-request server-side.

### Estado operativo

- Migrations 0002–0011 en producción (0011 beta readiness).
- Modal T4 `production-canary`: `mode=modal`, `kill_switch=false`, min=0/max=1/max_inputs=1/retries=0.
- Wake primario: `POST /api/create-request` → `wakeDispatchNext` (también `/api/wake-dispatch`).
- Recovery: cron Hobby diario `/api/dispatch-wake`.
- FREE: 3 créditos, 60 s máx; planes mini/practice/plus en `plan_limits`.
- Worker local como fallback.

## Arquitectura actual

- Web Next.js (Vercel) + Supabase Auth/Postgres/Storage.
- Browser: upload a `uploads/{uid}/…`; create/créditos/duración vía API server.
- Control plane → Modal T4; sin polling desde Modal.
- User credit ledger ≠ worker cost ledger.

Detalle: [`BETA_READINESS.md`](BETA_READINESS.md), [`MODAL_GENERAL_PROCESSING.md`](MODAL_GENERAL_PROCESSING.md).

## Stack

- Next.js 15, React 19, TypeScript, Canvas 2D.
- Python 3.12, FastAPI, PyTorch 2.11.0 + CUDA 12.8, FFmpeg.
- Vercel, Supabase, Modal T4, SQLite local.

## Estado del producto

MVP cloud listo para beta cerrada multiusuario con cuotas. Pagos no integrados.

## Decisiones activas

- Preservar MVP; escalar por fases.
- Web/PWA antes que nativas.
- Modal T4 + worker local fallback; sin polling Modal.
- Créditos por tutorial; reproducción sin costo de crédito.
- R2 / branding / pagos: pendientes.

## Último trabajo completado

2026-09-21: Beta Readiness (RLS por owner, entitlements, créditos, rate/concurrency, create-request, UX mínima).

## Siguiente tarea

Integrar pagos (MoR), Terms/Privacy, y validar beta con 10–20 usuarios externos.
