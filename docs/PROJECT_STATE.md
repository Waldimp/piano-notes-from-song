# Estado del proyecto

Actualizado: 2026-09-21

## Fase actual

**Mini Pack production-ready (prep)** — cobros reales **no** activados. Modal general intacto. Créditos/entitlements en Postgres; Wompi es solo PSP vía EnlacePago.

### Estado operativo

- Migrations 0002–0012 en producción (0012 Wompi billing prep).
- Modal T4 `production-canary`: `mode=modal`, `kill_switch=false`.
- Wake primario: create-request → wake-dispatch; cron Hobby = recovery.
- FREE 3×60s; Mini Pack checkout activo en **sandbox** (`BILLING_ENABLED=true`, `WOMPI_EXPECT_PRODUCTIVE=false`).
- Practice/Plus: catálogo + UI “Coming soon”; subscriptions bloqueadas.
- Legales: `/terms`, `/privacy`, `/refund` (públicas).

## Arquitectura actual

- Web Next.js (Vercel) + Supabase Auth/Postgres/Storage.
- Billing: `/api/billing/checkout` → EnlacePago; webhook HMAC + TransaccionCompra → settle.
- User credit ledger ≠ worker cost ledger ≠ Wompi.

Detalle: [`WOMPI_INTEGRATION.md`](WOMPI_INTEGRATION.md), [`BETA_READINESS.md`](BETA_READINESS.md).

## Stack

- Next.js 15, React 19, TypeScript, Canvas 2D.
- Python 3.12, FastAPI, PyTorch 2.11.0 + CUDA 12.8, FFmpeg.
- Vercel, Supabase, Modal T4, Wompi (modo desarrollo / prueba).

## Estado del producto

Beta cerrada multiusuario con cuotas. Mini Pack sandbox E2E validado. Go-live productivo documentado pero **no ejecutado**.

## Decisiones activas

- Preservar MVP; escalar por fases.
- Wompi vía EnlacePago (no 3DS propio).
- Créditos por tutorial; reproducción sin costo de crédito.
- R2 / branding: pendientes.
- Cutover productivo: checklist de un solo uso en `WOMPI_INTEGRATION.md` — pendiente decisión humana.

## Último trabajo completado

2026-09-21: **E2E Mini Pack sandbox PASSED** — purchase `5913c4ec…`, tx `88c8ed50…`, créditos 3→8, webhook HMAC OK, settle idempotente.

2026-09-21: **Prep production-ready sin cobro real** — legales, UX mínima (email en account, links legales, Practice/Plus “Coming soon”), kill-switch documentado, checklist cutover. `WOMPI_EXPECT_PRODUCTIVE` permanece `false`.

## Siguiente tarea

Cuando se decida go-live: ejecutar checklist cutover en `WOMPI_INTEGRATION.md` (panel productivo → `WOMPI_EXPECT_PRODUCTIVE=true` → redeploy → **una** compra $2.99 controlada). Practice/Plus siguen fuera de alcance.
