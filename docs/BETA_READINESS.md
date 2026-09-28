# Beta Readiness

Fecha: 2026-09-27 (actualiza la versión del 2026-09-21)
Estado: implementado para beta cerrada (Mini Pack en sandbox)

## Objetivo

Un usuario autenticado puede subir audio, consumir su cuota, recibir su tutorial y **no**
acceder a datos de otro usuario. Un usuario FREE puede probar **cualquier** canción.

## Planes internos (`plan_limits`)

| Plan | Créditos | Duración máx | Comportamiento con audio más largo | Activas | Req/min |
|---|---:|---:|---|---:|---:|
| free | 3 | 60 s | **vista previa**: se procesan solo los primeros 60 s | 1 | 4 |
| mini | 5 | 600 s | rechazo `duration_exceeded` | 1 | 6 |
| practice | 20 | 600 s | rechazo `duration_exceeded` | 1 | 8 |
| plus | 50 | 600 s | rechazo `duration_exceeded` | 1 | 10 |

Editable en SQL sin redeploy. Espejo documental en `apps/web/src/lib/beta/limits.ts` y
reglas puras en `apps/web/src/lib/beta/preview.ts` (con tests).

## Vista previa FREE (migración 0017)

- `authorize_beta_request` crea la request con `preview_seconds = 60` en vez de rechazar.
- El worker (Modal y local) recorta el audio con FFmpeg **antes** de transcribir
  (`piano_worker.preview` → `piano_ml.preprocessing.trim`): la GPU solo ve 60 s.
- `songs.preview_seconds` y `songs.source_duration_seconds` se heredan del request
  (trigger); el usuario no puede editarlos.
- UI: insignia "Vista previa · 1:00 de 3:14" en la biblioteca y en el reproductor, con
  CTA **Desbloquear completa**: FREE → precios; plan de pago con créditos →
  `POST /api/unlock-song` crea una request completa del mismo upload (1 crédito).
- Los uploads de previews se conservan 30 días (después, se pide volver a subir).

## Créditos (user ledger ≠ Modal cost ledger)

Flujo: **reserve → process → settle**; en error terminal: **release**. Idempotente por
`request_id`. Reproducir tutoriales existentes nunca consume créditos.

## Trust boundary

| Acción | Dónde |
|---|---|
| Upload Storage | Browser → `uploads/{uid}/…` (RLS path) |
| Crear request / créditos / duración / preview | `POST /api/create-request` + RPC `authorize_beta_request` |
| Desbloquear preview | `POST /api/unlock-song` (server; verifica owner, plan, crédito, upload vigente) |
| Uso/plan | `GET /api/usage` → `get_my_usage` |
| Wake | create-request (server), `POST /api/wake-dispatch` (navegador, rate-limited), `pg_cron`, cron Vercel |
| Limpieza uploads | cron Vercel diario → `list_expired_uploads` (service role) |
| Admin plan | `scripts/production-canary/admin_set_entitlement.py` (service_role) |

## RLS

`songs`/`requests` por `owner_id` / `requested_by = auth.uid()`; Storage `uploads` por
prefijo uid; `audio`/`notes` solo canciones propias; `_staging` nunca visible.

## Mensajes al usuario

Ningún código interno llega a la UI: `jobErrorMessage`, `mapCreateRequestError`,
`planLabel` y el filtro `looksTechnical` (snake_case, uuid, jwt, rpc) en
`apps/web/src/lib/userMessages.ts`, con tests.

## Tests

- Python: `ml/tests/test_trim.py`, `apps/worker/tests/test_preview.py` (recorte, resolución
  de `preview_seconds`, no-op en pagos). El test en vivo `test_live_rls_and_credit_gates`
  muta producción y solo corre con `PIANO_RUN_LIVE_TESTS=1`.
- Web: `lib/beta/preview.test.ts` (FREE=3, preview=60, límites de pago, decisión de
  desbloqueo), `lib/userMessages.test.ts`.

## Pendiente antes de beta pública

- Correo de producción (Resend + dominio) — `AUTH_EMAIL_RESEND.md`.
- Cutover de Mini Pack a cobros reales — decisión humana (`WOMPI_INTEGRATION.md`).
- CAPTCHA / rate limits más finos si aparece abuso.
- Practice/Plus: E2E real tras activar negocio productivo.
