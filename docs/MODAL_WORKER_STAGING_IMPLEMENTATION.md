# Implementación controlada del worker Modal — staging

Fecha: 2026-09-18. Alcance: staging únicamente. Producción no fue accedida ni
modificada.

## Resultado

Se implementó localmente el plano de control, la migración reversible, el
publisher compensable, el worker Modal T4, el dispatcher/outbox y la entrada
opt-in del worker local. No se aplicó ni desplegó ningún recurso cloud porque el
entorno disponible no contiene credenciales `STAGING_*` ni un Modal Environment
staging inequívoco. Las variables genéricas existentes se trataron como
producción y no fueron leídas por el nuevo código.

## Evidencia ejecutada

- `python -m pytest apps/worker/tests/test_controlled_worker.py -q`: 15 passed
  después del hardening.
- `python -m pytest ml/tests -q`: 49 passed.
- `npm run test:web`: 65 passed.
- `npm run build:web`: build exitoso.
- `python scripts/staging/apply_supabase_migration.py check`: hashes y lectura
  local válidos; no abre conexión.
- `python -m compileall`: módulos nuevos compilan.
- `git diff --check`: sin errores de whitespace.

Los 20 casos sintéticos locales prueban un oráculo de claim/idempotencia y no
son equivalentes a 20 canaries T4. No se reportan como canaries cloud.

## Recursos y costo

- Recursos Supabase staging creados: 0.
- Recursos Modal staging creados: 0.
- Jobs, buckets, secrets o tokens de producción usados: 0.
- GPUs/contenedores iniciados: 0.
- Costo observado de esta implementación: USD 0.00.

## Rollback

`0002_modal_worker_controlled_staging.down.sql` revierte triggers, RPCs, tablas,
índices, columnas y policies de la migración. Conserva deliberadamente los
roles NOLOGIN sin privilegios para evitar un `DROP ROLE` no determinista en
Supabase hospedado. Como la migración no fue aplicada, el rollback actual es
“no-op”; el ensayo UP → invariantes → DOWN sigue pendiente en staging real.

## Bloqueo y siguiente punto seguro

Para continuar sin riesgo se requiere un proyecto Supabase staging vacío y un
Modal Environment `staging`, con nombres/credenciales separados y confirmación
del project ref. Después se ejecutan, en orden: UP/DOWN/UP; catálogo y carreras;
RLS con JWT; deploy del endpoint; ACK/redelivery; 5–8 canaries dirigidos T4;
hard stop,
kill switch y rollback a local. Hasta completar esa evidencia la recomendación
es **NO-GO para producción**.

## 2026-09-18 — hardening local posterior al SECURITY REVIEW

La implementación local fue endurecida sin abrir conexiones ni crear recursos:

| Hallazgo | Corrección | Evidencia local |
|---|---|---|
| Identidad staging basada sólo en `STAGING_*` | Manifiesto canónico con fingerprint, URL Supabase exacta, project ref, endpoint Modal y entorno; cualquier ausencia o inconsistencia aborta | `controlled.py`, dispatcher, `apply_supabase_migration.py`, pruebas de identidad |
| Dispatcher invocable sin autorización | HMAC server-to-server con timestamp, secreto dedicado y ventana anti-replay; Proxy Auth sigue exigido en Modal | `supabase/functions/dispatch-modal-staging/index.ts` |
| Mass assignment y `songs.request_id` mutable | Grants por columna, triggers de campos server-owned, RPCs con parámetros explícitos y RLS/ACL de metadatos internos | migración `0002` |
| Spawn con control/lease obsoleto | `reserve_dispatch_spawn` y `authorize_dispatch_spawn` bloquean y revalidan modo, generación, kill switch, dueño y lease justo antes del spawn | migración `0002`, worker Modal |
| ACK perdido después de spawn | Estado durable `spawning/acknowledged`, observation ledger e RPC de reconciliación; un `dispatch_id` no se redespacha mientras sea ambiguo | migración `0002`, worker Modal |
| Upload/delete ambiguo | Verificación por descarga/hash/tamaño, ownership por intento y cleanup sólo con prueba; conflictos quedan retenidos para reconciliación | `controlled_publisher.py`, pruebas de I/O ambiguo |
| Rollback con `_staging` poblado | `DOWN` aborta antes de DDL si existen objetos staged, artefactos durables, leases o receipts ambiguos | `0002_modal_worker_controlled_staging.down.sql` |
| SECURITY DEFINER y metadatos | `search_path=pg_catalog`, objetos `public.` cualificados, owner NOLOGIN dedicado, revoke por defecto y execute mínimo | migración `0002` |

### Resultado de verificación local

- `python -m pytest ml/tests apps/worker/tests -q`: **64 passed**.
- `python -m compileall -q apps/worker/piano_worker benchmarks/modal/controlled_migration scripts/staging`: **OK**.
- `npm run test:web`: **65 passed**.
- `npm run build:web`: **OK** (Next.js compiló, tipado y páginas estáticas).
- `git diff --check`: **OK**.
- Supabase/Modal/Storage remotos, secretos, jobs, migraciones y GPUs: **0 accesos; 0 recursos; USD 0.00**.

La allowlist revisada [`scripts/staging/identity-allowlist.json`](../scripts/staging/identity-allowlist.json)
permanece deliberadamente vacía: no se inventó ni se fijó ningún project ref.
Por tanto, aunque el código ya rechaza cualquier identidad no anclada, ningún
despliegue staging puede pasar esta barrera hasta que MASTER agregue la identidad
real del proyecto temporal en un cambio revisado.

Las observaciones de reconciliación deben llegar como envelope HMAC con nonce,
timestamp y `STAGING_RECONCILER_SHARED_SECRET`; los objetos staged de trabajos ya
exitosos tienen una ruta CPU-only de verificación hash, borrado y marcado durable.

### Estado de aceptación

La segunda revisión estática final encontró **0 Critical, 0 High y 0 Medium**.
Los
casos que requieren staging temporal siguen siendo: ACL/RLS con JWT real,
aplicación UP/DOWN/UP contra PostgreSQL real, concurrencia de locks, ACK/replay
contra Modal real, reconciliación de llamadas observadas, coste/gpu-seconds,
rotación de secretos/checkpoint y rollback end-to-end. Por ello la decisión queda
**GO de seguridad únicamente para preparar un bootstrap separado de identidad
temporal; NO-GO para desplegar o ejecutar staging mientras la allowlist
permanezca vacía y falte la validación remota autorizada** y
**NO-GO para producción**, sin excepción.
