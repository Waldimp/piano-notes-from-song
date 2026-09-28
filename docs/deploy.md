# Operación y despliegue (estado real)

Actualizado: 2026-09-27. Sustituye a la guía original del MVP (Vercel + Supabase + worker
en la PC): hoy el procesamiento normal ocurre en **Modal T4** y la PC es solo fallback.

## Componentes

| Componente | Dónde | Cómo se despliega |
|---|---|---|
| Web (Next.js) | Vercel, proyecto `piano-notes-from-song`, raíz `apps/web` | `git push` a `main` |
| Auth / DB / Storage | Supabase `epapmenfnyfqdfmsgfee` | migraciones SQL con `.down.sql` |
| Despachador | Edge Function `dispatch-modal-staging` (nombre histórico) | `supabase functions deploy` |
| Worker GPU | Modal, environment `production-canary` (nombre histórico) | `modal deploy --env production-canary benchmarks/modal/controlled_migration/production_canary_worker.py` |
| Pagos | Wompi (sandbox hasta cutover) | variables en Vercel |

## Variables (dónde vive cada secreto)

- **Vercel (Production + Preview)**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` (solo rutas de servidor), `CRON_SECRET`,
  `PRODUCTION_CANARY_DISPATCH_WAKE_SECRET`, `WOMPI_*`, `BILLING_ENABLED`,
  `WOMPI_EXPECT_PRODUCTIVE`, `NEXT_PUBLIC_APP_URL`. Opcional: `NEXT_PUBLIC_SUPPORT_EMAIL`.
- **Modal secret** `piano-controlled-worker-production-canary-supabase`: URL, service key,
  endpoint e identidad (`PRODUCTION_CANARY_*`).
- **Supabase Vault**: `pianissimo_wake_url`, `pianissimo_cron_secret` (los usa `pg_cron`).
- **PC del operador** (`.env` / `.env.local`, git-ignorados): service key, `CRON_SECRET`,
  `PRODUCTION_PREFLIGHT_DATABASE_URL` (migraciones), `SUPABASE_ACCESS_TOKEN` (Management
  API; revocar cuando no se use).

## Cómo se procesa una canción

1. La web sube el audio a `uploads/{uid}/…` y llama a `POST /api/create-request`, que mide
   la duración y ejecuta `authorize_beta_request` (créditos, límites, **preview FREE**).
2. El trigger crea la fila en `dispatch_outbox`. El worker se despierta por, en orden:
   el propio `create-request` (servidor), el navegador cada 30 s mientras la canción siga
   en cola, **`pg_cron` cada minuto si hay trabajo elegible** (0017) y el cron diario de
   Vercel `/api/dispatch-wake` como última red.
3. Modal reclama el UUID, descarga, **recorta a `preview_seconds` si aplica**, transcribe,
   publica `playback.m4a` + `notes.json` y finaliza (`songs` + crédito liquidado).
4. El cron diario también borra uploads caducados (`list_expired_uploads`: >24 h sin uso;
   las vistas previas se conservan 30 días para poder desbloquearlas).

Controles: `worker_control.mode` (`modal` | `local` | `paused`) y `kill_switch`; hard stop
de gasto USD 20; `max_containers=1`, sin reintentos automáticos.

## Tareas frecuentes

```powershell
# Ver cola / estado (solo lectura)
.venv\Scripts\python scripts\production-canary\general_smoke.py

# Forzar un wake manual
.venv\Scripts\python scripts\production-canary\wake_dispatch.py --wake

# Crear o resetear una cuenta (sin depender del correo)
.venv\Scripts\python scripts\create_user.py correo@ejemplo.com "contraseña"

# Dar créditos/plan a un usuario
.venv\Scripts\python scripts\production-canary\admin_set_entitlement.py --user-id <uuid> --plan mini --credits 5

# Fallback: procesar con la PC (solo si worker_control.mode = local)
.venv\Scripts\python scripts\worker.py --once
```

## Aplicar una migración

```powershell
# .env.local: PRODUCTION_PREFLIGHT_DATABASE_URL=postgresql://...pooler.supabase.com:5432/postgres
.venv\Scripts\python - <<EOF
import os, psycopg; from pathlib import Path; from dotenv import load_dotenv
load_dotenv(".env.local")
with psycopg.connect(os.environ["PRODUCTION_PREFLIGHT_DATABASE_URL"]) as c:
    with c.transaction(): c.execute(Path("migrations/supabase/00NN_x.sql").read_text(encoding="utf-8"))
EOF
```

Cada migración tiene `.down.sql`. Antes de tocar `worker_control`, outbox o Storage, leer
`docs/PRODUCTION_MIGRATION_READINESS.md` (guardas y orden de rollback).

## Límites gratuitos vigentes

Supabase Free (500 MB DB, 1 GB Storage, 5 GB egreso/mes, correo 2/h → ver
`AUTH_EMAIL_RESEND.md`), Vercel Hobby (crons diarios), Modal (pago por uso, ~$0.003–0.008
por canción en T4).
