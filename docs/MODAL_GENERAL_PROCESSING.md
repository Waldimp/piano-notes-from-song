# Procesamiento general Modal

Fecha: 2026-09-21  
Estado: implementado y validado con smoke real  
Entorno Modal: `production-canary` (nombre histórico; opera como worker general)

## Flujo

```text
Usuario web
  → upload Storage + INSERT requests(queued)
  → trigger enqueue_controlled_request → dispatch_outbox(pending)
  → wake autenticado (Vercel cron /api/dispatch-wake o script)
  → Edge Function dispatch-modal-staging
       action=dispatch_next
       → acquire_next_modal_dispatch (UUID elegible, no elegido por el cliente)
       → POST Modal (Proxy Auth) con receipt explícito
  → Modal T4
       → reserve_dispatch_spawn
       → reserve/bind/authorize cost
       → claim_request → transcribe → publish → finalize
  → request done
```

Modal **no** hace polling de Supabase.

## Controles

| Control | Comportamiento |
|---|---|
| `mode=paused` | cero dispatches nuevos |
| `mode=modal` | outbox elegible → Modal |
| `mode=local` | Modal no recibe; worker local puede reclamar |
| `kill_switch=true` | override absoluto; cero dispatches |

`set_worker_mode` y `clear_worker_kill_switch` rebasan `dispatch_outbox.pending` a la generación nueva.

## Límites

- T4, `min_containers=0`, `max_containers=1`, `max_inputs=1`, `retries=0`
- Hard stop de ledger a USD 20 (automático → kill switch)
- Reserva por intento ≈ USD 0.03
- Retries automáticos del runner: **deshabilitados** (`p_retryable=false`)

## Wake

- Secreto: `PRODUCTION_CANARY_DISPATCH_WAKE_SECRET`
- Ruta web: `POST/GET /api/dispatch-wake` (protegida por `CRON_SECRET`)
- Cron Vercel: cada minuto
- Script: `scripts/production-canary/wake_dispatch.py --wake`

## Deuda de naming (no bloqueante)

- Edge Function slug: `dispatch-modal-staging`
- Modal Environment / App: `production-canary`
- Prefijo de Storage privado: `_staging`

## Deuda técnica restante

- Retries formales posteriores a compensación: `record_request_artifact` ya permite reutilizar rutas `cleaned` del mismo request; el runner sigue sin reintentar automáticamente.
- El wake depende de cron/script; no hay Database Webhook/`pg_net` todavía (latencia hasta ~1 min en producción Vercel).
