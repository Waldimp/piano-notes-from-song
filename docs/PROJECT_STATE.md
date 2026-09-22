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

2026-09-21: **Subscription sync/reconcile** — Términos (auto-renew + retry 4h×2 días); OpenAPI snapshot fields; migration 0014; Δ pagosRealizados sin auto-grant. `BILLING_SUBSCRIPTIONS_ENABLED` sigue false.

## BETA UX READINESS

Actualizado: 2026-09-21 (beta cerrada / comercial temprana — sin tocar Modal, RLS, recurrente Wompi).

| Área | Estado |
| --- | --- |
| Branding UI | **Pianissimo** (metadata EN, UI ES) |
| Públicas | `/landing`, `/login`, `/terms`, `/privacy`, `/refund`, `/pricing` (auth) |
| Home | **Tus canciones** — jobs + biblioteca unificados, empty state, onboarding dismissible |
| Upload | Límites plan, validación, copy amigable (sin Modal/worker) |
| Pricing | FREE / Mini Pack / Practice+Plus Coming soon; aviso sandbox si `!wompi_expect_productive` |
| Account | Email visible, plan, créditos, facturación, legal |
| Soporte | `NEXT_PUBLIC_SUPPORT_EMAIL` (opcional) en footer |
| Analytics | Solo documentado — [`ANALYTICS_EVENTS.md`](ANALYTICS_EVENTS.md) |

**Pendiente beta 5–10 usuarios:** email soporte en prod, invitaciones/onboarding humano opcional, QA móvil real, cutover Mini Pack productivo (decisión aparte), respuesta Wompi recurrente.

## PLAYER / TUTORIAL STATE

Actualizado: 2026-09-21 — polish de producto sobre Canvas 2D existente (sin WebGL, sin MIDI input).

| Área | Estado |
| --- | --- |
| Reloj | `<audio>` autoritativo + `MediaClock` (interpolación anti-jitter) |
| Controles | Play/Pausa, seek, tiempo, velocidades **0.5 / 0.75 / 1 / 1.25**, sync ±ms, marcadores |
| Loop | Botón Loop + A / B / Clear; wrap al llegar a B; seek fuera del rango → A; guías en canvas |
| Manos | Filtro Ambas/Izq/Der **si** `hand !== null`; asignación = heurística de pitch (`ml/piano_ml/hands.py`), no exacta |
| Mobile | Hint landscape no bloqueante; controles táctiles; seek full-width en ≤600px |
| Fullscreen | `requestFullscreen` sobre el root del tutorial |
| Atajos | Space play/pause; ←/→ ±5s (ignorados en inputs) |
| Performance | UI clock ~10 Hz; visible-range binario; sin re-render React a 60 fps |
| Loading/errores | Estados claros + retry; sin paths/stack/Modal |

**Limitaciones conocidas:** sin pitch-preservation perfecta en todos los navegadores; manos aproximadas; sin wait-for-you / MIDI / partitura; teclado 88 teclas a ancho completo (en vertical es estrecho).

## Siguiente tarea

Enviar preguntas a soporte Wompi (lista en `WOMPI_INTEGRATION.md`). Tras respuestas: cablear correlación + cancel individual + E2E sandbox. Mini Pack cutover productivo sigue siendo decisión separada.
