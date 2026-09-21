# Beta Readiness

Fecha: 2026-09-21  
Estado: implementado para beta cerrada (sin pagos)

## Objetivo

Un usuario autenticado puede subir audio, consumir su cuota, recibir su tutorial y **no** acceder a datos de otro usuario.

## Planes internos (`plan_limits`)

| Plan | Créditos | Duración máx | Activas | Req/min |
|---|---:|---:|---:|---:|
| free | 3 | 60 s | 1 | 4 |
| mini | 5 | 600 s | 1 | 6 |
| practice | 20 | 600 s | 1 | 8 |
| plus | 50 | 600 s | 1 | 10 |

Editable en SQL sin redeploy. Espejo documental en `apps/web/src/lib/beta/limits.ts`.

## Créditos (user ledger ≠ Modal cost ledger)

Flujo: **reserve → process → settle**; en error terminal: **release**.

- Reserva atómica en `authorize_beta_request`
- Settle en `finalize_request`
- Release en `fail_request_attempt` (no retryable)
- Idempotencia: un `reserve` único por `request_id`

## FREE

- 3 créditos al primer `ensure_account_entitlement`
- Archivos > 60 s: **rechazados** antes de Modal (sin consumo de crédito/GPU)
- Sin créditos: mensaje + CTA placeholder “Upgrade — coming soon”

## Trust boundary

| Acción | Dónde |
|---|---|
| Upload Storage | Browser → `uploads/{uid}/…` (RLS path) |
| Crear request / créditos / duración | `POST /api/create-request` + RPC `authorize_beta_request` |
| Uso/plan | `GET /api/usage` → `get_my_usage` |
| Wake interactivo | create-request (server) + `POST /api/wake-dispatch` |
| Wake recovery | cron `/api/dispatch-wake` |
| Admin plan | `scripts/.../admin_set_entitlement.py` (service_role) |

## RLS

Antes: `songs`/`requests` SELECT `using (true)` (biblioteca compartida).  
Después: `requested_by = auth.uid()` / `owner_id = auth.uid()`; Storage uploads por prefijo uid; audio/notes sólo canciones propias.

## Admin seed

```bash
python scripts/production-canary/admin_set_entitlement.py --user-id <uuid> --plan mini --credits 5
```

## Pagos

Proveedor elegido: **Wompi El Salvador**. Preparación en [`WOMPI_INTEGRATION.md`](WOMPI_INTEGRATION.md) (migration 0012). Sin cobros hasta sandbox + `BILLING_ENABLED`.

## Pendiente

- Credenciales sandbox Wompi + E2E Mini Pack
- Terms/Privacy
- Rate limits más finos / CAPTCHA
- Branding
- R2
