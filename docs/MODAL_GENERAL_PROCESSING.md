# Procesamiento general Modal

Fecha: 2026-09-27 (actualiza la versión del 2026-09-21)
Estado: en producción
Entorno Modal: `production-canary` (nombre histórico; opera como worker general)

## Flujo

```text
Usuario web
  → upload Storage + POST /api/create-request → authorize_beta_request
       (créditos, límites; FREE con audio > 60 s → preview_seconds = 60)
  → trigger enqueue_controlled_request → dispatch_outbox(pending)
  → wake autenticado (ver "Wake")
  → Edge Function dispatch-modal-staging  action=dispatch_next
       → acquire_next_modal_dispatch (UUID elegible, nunca elegido por el cliente)
       → POST Modal (Proxy Auth) con receipt explícito
  → Modal T4
       → reserve_dispatch_spawn → reserve/bind/authorize cost
       → claim_request → descarga
       → [preview] trim_audio_head(input, preview_seconds)   ← antes de la GPU
       → transcribe → publish → finalize_request
  → request done · songs.preview_seconds heredado del request
```

Modal **no** hace polling de Supabase.

## Wake (de más rápido a más lento)

| Fuente | Cuándo | Latencia |
|---|---|---|
| `POST /api/create-request` (servidor) | al crear la solicitud | inmediata |
| Navegador (`/api/wake-dispatch`, rate-limited) | cada 30 s mientras la canción siga `queued` y la pestaña abierta | ≤ 30 s |
| `pg_cron` → `wake_dispatch_if_pending()` → `net.http_post` a `/api/dispatch-wake` | cada minuto, **solo** si hay outbox `pending` elegible y `mode=modal` sin kill switch | ≤ 60 s |
| Cron Vercel diario `/api/dispatch-wake` (GET) | 12:05 UTC | recuperación + limpieza de uploads |

Secretos del wake por `pg_cron` en Supabase Vault: `pianissimo_wake_url`,
`pianissimo_cron_secret`. Sin ellos la función devuelve `skipped:no_vault_secrets`.
Diagnóstico: `select * from net._http_response order by created desc` y
`cron.job_run_details`.

## Controles

| Control | Comportamiento |
|---|---|
| `mode=paused` | cero dispatches nuevos |
| `mode=modal` | outbox elegible → Modal |
| `mode=local` | Modal no recibe; worker local puede reclamar |
| `kill_switch=true` | override absoluto; cero dispatches |

## Límites

- T4, `min_containers=0`, `max_containers=1`, `max_inputs=1`, `retries=0`
- Hard stop de ledger a USD 20 (automático → kill switch); reserva por intento ≈ USD 0.03
- Retries automáticos del runner: deshabilitados (`p_retryable=false`)

## Limpieza de uploads

`public.list_expired_uploads(min_age_hours=24, preview_retention_days=30)` decide;
`/api/dispatch-wake` (GET diario) borra vía Storage API. Se conservan: uploads de
solicitudes `queued/processing`, terminales de menos de 24 h y **previews FREE de menos de
30 días** (necesarias para "desbloquear canción completa"). Primera pasada manual el
2026-09-27: 9 objetos (3 huérfanos de E2E, 6 de solicitudes terminadas).

## Deuda restante

- Naming histórico (`dispatch-modal-staging`, `production-canary`, `_staging`).
- Sin reintento automático tras fallo (decisión: el usuario vuelve a subir; el crédito se
  devuelve en `fail_request_attempt`).
- Sin Database Webhook: el wake más rápido tras el navegador es `pg_cron` (≤ 60 s).

## Runbook: "no_eligible_dispatch" con trabajo en cola (receipt atascado)

`acquire_next_modal_dispatch` **no despacha nada** mientras exista cualquier fila de
`dispatch_outbox` en `leased`, `spawning` o `acknowledged` (exclusión mutua de un solo
slot). Si una de esas filas pertenece a una request que ya es terminal (`done`/`error`),
el slot queda tomado para siempre y la cola se congela en silencio: el wake responde
`{"status":"idle","reason":"no_eligible_dispatch"}` aunque haya `pending`.

Detectado el 2026-09-27: el receipt `8a21c3d2-63ef-4672-b50a-6a266465470d` (request
`3f35d1e8…`, `long.mp3`, E2E del 2026-09-21) quedó `acknowledged` con `modal_call_id`
tras marcarse la request como `error` a mano; bloqueó Modal desde el 2026-09-21 13:02 UTC.

Diagnóstico (solo lectura):

```sql
select d.dispatch_id, d.state, d.acknowledged_at, r.status, r.filename
from public.dispatch_outbox d join public.requests r on r.id = d.request_id
where d.state in ('leased','spawning','acknowledged');
```

Corrección (solo si la request es terminal y no hay contenedor activo en Modal):

```sql
update public.dispatch_outbox
set state = 'closed', updated_at = clock_timestamp(),
    last_error = coalesce(last_error, '') || ' | closed by operator: request terminal'
where dispatch_id = '<dispatch_id>'
  and state in ('leased','spawning','acknowledged')
  and exists (select 1 from public.requests r where r.id = request_id and r.status in ('done','error'));
select public.wake_dispatch_if_pending();   -- o esperar al pg_cron (≤ 1 min)
```

Prevención: nunca marcar una request como `error` con un UPDATE directo mientras tenga
receipt activo; usar `fail_request_attempt` (cierra outbox y libera crédito). El test
en vivo `test_live_rls_and_credit_gates` ya no corre por defecto.
