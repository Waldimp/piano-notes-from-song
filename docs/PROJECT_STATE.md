# Estado del proyecto

Actualizado: 2026-09-21

## Fase actual

**SUBSCRIPTIONS PARTIALLY READY** — Practice/Plus schema + adapters + HARD BLOCK. Mini Pack sandbox production-ready sin cobros reales. Modal general intacto.

### Estado operativo

- Migrations 0002–0012 en producción; **0013** (subscriptions period grants) lista para aplicar.
- Modal T4 `production-canary`: `mode=modal`, `kill_switch=false`.
- FREE 3×60s; Mini Pack sandbox (`BILLING_ENABLED=true`, `WOMPI_EXPECT_PRODUCTIVE=false`).
- Practice/Plus: catálogo + UI disabled; `BILLING_SUBSCRIPTIONS_ENABLED=false`; afiliación/cancel/grant bloqueados por gaps docs Wompi.
- Legales: `/terms`, `/privacy`, `/refund`.

## Arquitectura actual

- Web Next.js (Vercel) + Supabase Auth/Postgres/Storage.
- Billing one-time: EnlacePago → webhook HMAC + TransaccionCompra → settle.
- Billing subscriptions: EnlacePagoRecurrente adapters + `grant_subscription_period_credits` preparados; **no** auto-grant.
- User credit ledger ≠ worker cost ledger ≠ Wompi.

Detalle: [`WOMPI_INTEGRATION.md`](WOMPI_INTEGRATION.md).

## Stack

- Next.js 15, React 19, TypeScript, Canvas 2D.
- Python 3.12, FastAPI, PyTorch 2.11.0 + CUDA 12.8, FFmpeg.
- Vercel, Supabase, Modal T4, Wompi (modo desarrollo).

## Estado del producto

Beta cerrada. Mini Pack sandbox E2E passed. Practice/Plus parcialmente listos (sin E2E recurrente).

## Decisiones activas

- Wompi vía EnlacePago / EnlacePagoRecurrente (no 3DS propio).
- No inventar correlación webhook↔suscriptor ni cancel individual.
- R2 / branding: pendientes.

## Último trabajo completado

2026-09-21: Mini Pack production-ready prep (legales, cutover checklist) sin cobro real.

2026-09-21: **SUBSCRIPTIONS PARTIALLY READY** — auditoría OpenAPI Wompi, migration 0013, adapters GET suscripciones/disable, RPC period grants, API HARD BLOCK, tests. Sin E2E Practice/Plus (docs insuficientes).

## Siguiente tarea

Enviar preguntas a soporte Wompi (lista en `WOMPI_INTEGRATION.md`). Tras respuestas: cablear correlación + cancel individual + E2E sandbox. Mini Pack cutover productivo sigue siendo decisión separada.
