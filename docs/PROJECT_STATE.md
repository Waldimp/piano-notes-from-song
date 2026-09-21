# Estado del proyecto

Actualizado: 2026-09-21

## Fase actual

**Wompi billing preparation** sobre Beta Readiness. Modal general intacto. Créditos/entitlements siguen en Postgres; Wompi es solo PSP.

### Estado operativo

- Migrations 0002–0012 en producción (0012 Wompi billing prep).
- Modal T4 `production-canary`: `mode=modal`, `kill_switch=false`.
- Wake primario: create-request → wake-dispatch; cron Hobby = recovery.
- FREE 3×60s; Mini Pack checkout preparado (`BILLING_ENABLED` default off).
- Practice/Plus: catálogo + UI, subscriptions bloqueadas hasta lifecycle Wompi.

## Arquitectura actual

- Web Next.js (Vercel) + Supabase Auth/Postgres/Storage.
- Billing: `/api/billing/checkout` → EnlacePago; webhook HMAC + TransaccionCompra → settle.
- User credit ledger ≠ worker cost ledger ≠ Wompi.

Detalle: [`WOMPI_INTEGRATION.md`](WOMPI_INTEGRATION.md), [`BETA_READINESS.md`](BETA_READINESS.md).

## Stack

- Next.js 15, React 19, TypeScript, Canvas 2D.
- Python 3.12, FastAPI, PyTorch 2.11.0 + CUDA 12.8, FFmpeg.
- Vercel, Supabase, Modal T4, Wompi (sandbox pending credentials).

## Estado del producto

Beta cerrada multiusuario con cuotas. Pagos: código listo, sin credenciales reales ni cobros.

## Decisiones activas

- Preservar MVP; escalar por fases.
- Wompi vía EnlacePago (no 3DS propio).
- Créditos por tutorial; reproducción sin costo de crédito.
- R2 / branding / Terms: pendientes.

## Último trabajo completado

2026-09-21: Intento E2E Mini Pack sandbox — **HARD STOP** sin credenciales Wompi en Vercel/local. UX return corregida; gates negativos unit-tested; helper `e2e_wompi_mini_pack.py`.

## Siguiente tarea

Añadir en Vercel (`piano-notes-from-song`) las env Wompi de desarrollo + `NEXT_PUBLIC_APP_URL` + `BILLING_ENABLED=true`, redeploy, y completar E2E Mini Pack.
