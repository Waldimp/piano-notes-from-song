# 01F — Production migration readiness

Fecha: 2026-09-19. Estado: **NO-GO operativo**. Este documento sólo prepara
una futura ventana; no consulta Supabase, no aplica SQL, no despliega Modal ni
Edge Functions y no contiene valores de credenciales.

## 1. Identidad cerrada

El perfil nuevo es `PIANO_ENVIRONMENT=production-canary` y usa exclusivamente
`PRODUCTION_CANARY_*`. El `project_ref`, URL y endpoint deben aparecer como
valores exactos dentro de `scripts/production-canary/identity-allowlist.json` y
su manifiesto debe tener un SHA-256 revisado. El archivo está intencionalmente
vacío. `MODAL_ENVIRONMENT=production-canary` es un Environment dedicado al
canary. `_staging` sigue siendo sólo el namespace privado de Storage dentro del
proyecto productivo; no es otro proyecto Supabase. Variables genéricas,
variables `STAGING_*` cruzadas, allowlist vacía, fingerprint inválido o ausencia
de manifiesto bloquean antes de crear un cliente.

La configuración Modal preparada es T4, `min_containers=0`, `max_containers=1`,
`max_inputs=1`, `retries=0`, Proxy Auth obligatorio, y una invocación sólo por
receipt/UUID explícito. No existe polling en el worker. El dispatcher no tiene
trigger general y el estado inicial de DB es `mode='paused'`, `kill_switch=true`.

## 2. Inventario SQL UP/DOWN

Fuentes exactas: `migrations/supabase/0002_modal_worker_controlled_staging.sql`
(1,415 líneas), su DOWN (120 líneas), y el adjuncto local
`0003_production_canary_single_uuid.sql` (118 líneas) con su DOWN (18 líneas).
Los rangos son inclusivos y deben verificarse contra el hash antes de una
ventana. La migración actual se escribió para staging; antes de producción debe
revisarse sólo el binding de identidad y los supuestos marcados aquí, no
relajarse ninguna guarda.

| UP | DOWN | Tipo / objeto / operación | Locks, datos incompatibles y pérdida | Grants/RLS/reversión |
|---|---|---|---|---|
| 1–23 | 112–118 | Roles `worker_control_owner/admin`; enum `public.worker_mode`; crea roles/enum si faltan. | Catálogo y locks de DDL. Choca con roles/tipo existentes de distinta definición. El DOWN no elimina roles, sólo revoca schema; el enum se elimina al final y falla si quedan dependencias. | Privilegios de roles se otorgan al final (1306–1395); RLS no aplica al catálogo. |
| 25–52 | 81–97 | `requests`: columnas server-owned/defaults/checks; backfill `target_song_id`; NOT NULL; tres índices. `songs.request_id` FK e índice único parcial. | `ALTER TABLE` toma lock fuerte; backfill escribe todas las filas. Falla por IDs duplicados, `song_id` nulo inesperado, `target_song_id` ya ocupado o rows que violen checks. DOWN pierde todas las columnas agregadas, índices y FK; no borra filas base. | Reemplaza grants de requests/songs (1275–1280). Preflight: duplicados, NULLs, checks y colisiones. Postflight: conteos, `pg_indexes`, FK y grants. |
| 55–79 | 72–79 | Tablas `worker_control`, `worker_control_events`; seed pausado/kill activo. | Locks DDL y row lock del singleton. Datos existentes no deben sobreescribirse por `ON CONFLICT`; un control previo incompatible no se corrige. DOWN destruye historial y control. | RLS y revokes 1253–1274/1306–1317. Sólo reversible con checkpoint del control y sin trabajo activo. |
| 81–150 | 74–77 | `request_attempts`, `request_artifacts`, `dispatch_outbox` e índices; FK cascade, uniques, estados y ownership. | `CREATE TABLE/INDEX`; datos legacy no tienen `attempt_no`/receipts. DOWN pierde historial, receipts y artefactos metadata después de la guarda. | RLS deny-by-default; sólo RPCs con roles controlados. Preflight: ausencia de objetos homónimos incompatibles y cero leases para rollback. |
| 152–166 | 72–74 | `dispatch_reconciliations`, `dispatch_auth_nonces`. | DDL; nonces caducan por cleanup en RPC. DOWN elimina evidencia anti-replay/reconciliación. | RLS habilitado, sin grants directos; RPC consume nonce. |
| 168–286 | 54–56 | `consume_dispatch_auth_nonce`, `reserve_worker_cost`, `settle_worker_cost`, `release_worker_cost` SECURITY DEFINER; ledger y FK de reserva. | Locks de fila/ledger; datos de ledger con tipos/metadata inválidos bloquean. `settle`/`release` son idempotentes por reservation metadata; DOWN pierde ledger y evidencia de gasto. | `search_path=pg_catalog`; owner/grants controlados. Pre/post: funciones, owner, search_path, sumas y kill switch. |
| 295–383 | 37–43 | Triggers/functions de preparación, enqueue y guard de mutación; reemplaza triggers homónimos. | Locks de tabla y cambio de comportamiento de INSERT/UPDATE. Datos/clients que hagan mass assignment fallarán (intencional). DOWN restaura sólo triggers/policies baseline documentados; no reconstruye customizaciones desconocidas. | `SECURITY DEFINER` en funciones servidor; grants públicos revocados. |
| 385–570 | 44–50 | `claim_request`, `heartbeat_request`, `finalize_request`. Claim/lease/ownership y publicación final idempotente. | Row locks en control/request/attempt; filas en estados no esperados, `song_id` existente o leases vencidos impiden claim/finalize. DOWN elimina RPCs, no datos por sí mismo. | Ejecución sólo desde roles permitidos (1364–1395); RLS indirecto vía funciones. |
| 572–794 | 47–50,62–64 | Outcome, registro/limpieza de artefactos, fallo de intento. | FKs y ownership; objetos Storage huérfanos o hashes incorrectos bloquean flujo/rollback. DOWN elimina funciones y deja objetos sólo si la guarda ya pasó. | Funciones SECURITY DEFINER con `search_path`; pre/post comparar ownership y hashes. |
| 795–907 | 51–53 | `acquire_dispatch_slot`, `acquire_local_dispatch`, `recover_expired_request`. | Locks en outbox/requests; receipts `leased/spawning/acknowledged` hacen rollback no seguro. | Dispatcher no se activa por DDL. DOWN elimina capacidad de despacho/recuperación. |
| 908–1052 | 57–61 | Reserva/autorización de spawn, binding de costo, ACK y retorno no-spawn. | Carrera entre receipt y spawn; no reabrir resultados ambiguos. DOWN sólo tras reconciliación completa. | Sólo owner/admin vía EXECUTE; cost ledger y generación protegen doble spawn. |
| 1054–1137 | 65–67 | Candidatos y `reconcile_dispatch`; observación explícita `accepted/not_found`. | Timeout no equivale a `not_found`; DOWN pierde capacidad de resolver estado ambiguo. | RLS cerrado y reconciliación CPU externa autenticada. |
| 1139–1251 | 68–70 | Cambio de modo, kill switch y clear condicionado por generación. | Row lock; cualquier lease activo o generación stale debe impedir transición. DOWN elimina control remoto. | Ejecutables sólo al rol administrativo; estado inicial pausado/kill activo. |
| 1253–1304 | 105–110 | RLS de tablas controladas; revokes/grants de requests/songs; policies Storage de lectura/borrado que excluyen `_staging`. | Lock de tablas/policies. Usuarios productivos que dependan de grants amplios pueden perder acceso; no se permite asumirlo. DOWN restaura policies baseline sólo para audio/notes. | Es el impacto RLS principal: acceso autenticado canónico se conserva, `_staging` se niega; service-role omite RLS. |
| 1306–1413 | 118 | Grants a roles, owners de SECURITY DEFINER, revokes y EXECUTE explícito. | Puede fallar si roles/funciones tienen ownership externo. DOWN revoca schema de roles pero retiene roles; privileges preexistentes no se pueden reconstruir sin snapshot. | Snapshot obligatorio de roles/grants/owners antes; postflight con `information_schema`/`pg_proc`. |
| 0003: 1–118 | 0003 DOWN: 1–18 | `production_canary_arm` singleton; `arm_production_canary_uuid` y `reserve_production_canary_spawn` SECURITY DEFINER; RLS, owners y EXECUTE mínimo. | `FOR UPDATE` serializa arm/reserva; la reserva y consumo son una transacción. Stale/error no consume; DOWN se niega si queda UUID armado. No se fija ningún UUID en el repositorio. | `worker_control_owner` sólo recibe SELECT/UPDATE; `service_role` sólo EXECUTE de reserva; `worker_control_admin` sólo EXECUTE de armado. |

No hay `CREATE POLICY` de Storage para escritura `_staging`: la publicación
server-side usa service-role y la ruta privada permanece excluida del usuario.
La migración no crea buckets ni copia objetos. Los backups PostgreSQL tampoco
contienen bytes de Storage.

### Ledger de funciones y triggers

Para evitar que el inventario por bloques oculte una RPC, este es el detalle
función-a-función. Todas las funciones UP son `SECURITY DEFINER` salvo
`guard_controlled_mutation` (trigger interno), llevan `set search_path =
pg_catalog` en el SQL y se exponen únicamente por los grants de 1346–1413.
Cada nombre/signatura corresponde al `DROP FUNCTION` homónimo de DOWN:

| UP (líneas) | Función / trigger | DOWN |
|---|---|---|
| 168–186 | `consume_dispatch_auth_nonce(uuid,timestamptz)` | 67 |
| 204–239 | `reserve_worker_cost(uuid,uuid,numeric)` | 54 |
| 240–270 | `settle_worker_cost(bigint,numeric,numeric,jsonb)` | 55 |
| 271–294 | `release_worker_cost(bigint,text)` | 56 |
| 295–306 | `prepare_controlled_request()` | 43 |
| 307–324 | `enqueue_controlled_request()` | 42 |
| 325–364 | `guard_controlled_mutation()` | 41 |
| 365–369 / 370–374 / 375–379 / 380–384 | triggers `requests_guard_controlled`, `songs_guard_controlled`, `requests_prepare_controlled`, `requests_enqueue_controlled` | 37–40 |
| 385–460 | `claim_request(uuid,text,uuid,integer,bigint,integer)` | 44 |
| 461–495 | `heartbeat_request(uuid,uuid,uuid,integer)` | 45 |
| 496–571 | `finalize_request(...)` | 46 |
| 572–594 | `inspect_attempt_outcome(uuid,uuid,uuid)` | 47 |
| 595–653 | `record_request_artifact(...)` | 48 |
| 654–673 | `get_owned_artifact(...)` | 62 |
| 674–695 | `list_completed_staging_artifacts(integer)` | 63 |
| 696–716 | `mark_completed_staging_artifact_cleaned(...)` | 64 |
| 717–745 | `mark_artifact_cleaned(...)` | 49 |
| 746–794 | `fail_request_attempt(...)` | 50 |
| 795–830 | `acquire_dispatch_slot(text,bigint,integer)` | 51 |
| 831–859 | `acquire_local_dispatch(uuid,bigint,integer)` | 52 |
| 860–907 | `recover_expired_request(uuid,uuid,text)` | 53 |
| 908–950 | `reserve_dispatch_spawn(...)` | 57 |
| 951–971 | `bind_dispatch_cost_reservation(...)` | 58 |
| 972–1014 | `authorize_dispatch_spawn(...)` | 59 |
| 1015–1036 | `ack_dispatch(uuid,text,text)` | 60 |
| 1037–1053 | `return_unspawned_dispatch(uuid,text)` | 61 |
| 1054–1074 | `list_dispatch_reconciliation_candidates(integer,integer)` | 65 |
| 1075–1138 | `reconcile_dispatch(uuid,text,text,text)` | 66 |
| 1139–1183 | `set_worker_mode(bigint,worker_mode,text)` | 68 |
| 1184–1211 | `engage_worker_kill_switch(text)` | 69 |
| 1212–1252 | `clear_worker_kill_switch(bigint,text)` | 70 |

El DOWN también revierte policies Storage (105–110), columnas/índices (81–97),
tablas (72–79), enum (112), y revoca el schema de roles (118), pero retiene
los roles para no asumir ownership de Supabase. No hay una reversión segura si
el preflight detecta datos productivos incompatibles: se aborta antes de DDL.

## 3. Consultas PRE-UP y POST-UP (ejecutar sólo durante una autorización futura)

Guardar resultados y hashes, sin secretos. Las consultas PRE-UP usan únicamente
el esquema baseline; no referencian `target_song_id`, leases, outbox, ledger ni
ninguna columna/tabla creada por 0002.

### PRE-UP — sólo baseline

```sql
select current_database(), current_user, current_setting('server_version');
select count(*) as requests from public.requests;
select id, status, song_id, audio_path, created_at from public.requests
where status in ('processing','done') or song_id is not null order by created_at;
select column_name, data_type, is_nullable, column_default
from information_schema.columns where table_schema='public'
  and table_name in ('requests','songs') order by table_name, ordinal_position;
select indexname, indexdef from pg_indexes
where schemaname='public' and tablename in ('requests','songs') order by indexname;
select grantee, table_schema, table_name, privilege_type
from information_schema.role_table_grants
where table_schema in ('public','storage') order by 1,2,3,4;
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid),
       p.prosecdef, p.proconfig, r.rolname
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
where n.nspname='public' order by p.proname;
select bucket_id, split_part(name,'/',1) as prefix, count(*)
from storage.objects group by 1,2 order by 1,2;
```

### POST-UP — sólo después de confirmar commit de UP

```sql
select count(*) as requests, count(*) filter (where target_song_id is null) as null_targets
from public.requests;
select target_song_id, count(*) from public.requests group by 1 having count(*) > 1;
select id, status, song_id, target_song_id, worker_kind, attempt_count,
       lease_expires_at, trace_id from public.requests order by created_at;
select schemaname, tablename, rowsecurity from pg_tables
where schemaname in ('public','storage') order by 1,2;
select singleton, mode, kill_switch, generation from public.worker_control;
select state, count(*) from public.dispatch_outbox group by state;
select status, count(*) from public.request_attempts group by status;
select coalesce(sum(case kind when 'release' then -amount_usd else amount_usd end),0)
from public.worker_cost_ledger;
select singleton, request_id, armed_at, consumed_at
from public.production_canary_arm;
select p.proname, pg_get_function_identity_arguments(p.oid), p.prosecdef,
       p.proconfig, r.rolname as owner
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
join pg_roles r on r.oid=p.proowner
where n.nspname='public'
  and p.proname in ('arm_production_canary_uuid','reserve_production_canary_spawn');
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema='public' and table_name='production_canary_arm';
select grantee, routine_name, privilege_type
from information_schema.role_routine_grants
where routine_schema='public'
  and routine_name in ('arm_production_canary_uuid','reserve_production_canary_spawn');
select rolname, rolsuper, rolcanlogin
from pg_roles where rolname='worker_control_owner';
select bucket_id, split_part(name,'/',1) as prefix, count(*)
from storage.objects group by 1,2 order by 1,2;
select count(*) from storage.objects where name like '_staging/%';
```

Postflight adicional: comprobar exactamente `worker_control = (paused,true,1)`,
cero outbox activa/costo reservado, ausencia de `_staging` visible al usuario,
policies/grants esperados, funciones con `prosecdef=true` y
`search_path={pg_catalog}`, owner `worker_control_owner`, y sólo los grants
esperados. Antes de cualquier GPU, la autorización debe ser una única fila
singleton en `production_canary_arm`; no se autoriza un selector de cola.

## 4. Backup, checkpoint y restore

Preparar en una máquina segura y con destino explícito: `pg_dump --format=custom
--no-owner --no-acl`, hash SHA-256 del archivo, prueba de lectura con
`pg_restore --list`, y conservar su catálogo como evidencia. Exportar por separado
schema, roles/memberships, grants, policies/RLS, funciones/owners/config y
extensiones. No imprimir URLs ni secretos. Un dump DB no contiene bytes de
`storage.objects`; verificar esto y hacer inventario/copia separada de cada
objeto afectado (`bucket_id`, `name`, size, hash SHA-256, metadata), con hashes
del manifiesto de objetos. No ejecutar ahora.

El checkpoint final de mantenimiento debe registrar: hash de dump y snapshot,
conteos/IDs de requests, `worker_control`, outbox/attempts/leases, ledger,
listado y hashes de Storage, policies/grants/functions, versión Git y estado
del worker local. El ensayo de restore completo en una base aislada no forma
parte de la validación aprobada para esta fase y debe registrarse como riesgo
residual. Si se autoriza después, el restore completo debe validar catálogo,
roles, RLS y objetos Storage por hash antes de considerar promoción. Restore
selectivo: únicamente tablas/funciones aprobadas, con dependencias y grants
explícitos. La recuperación del worker local es
detener dispatcher, dejar `paused/kill=true`, reactivar el worker local por su
camino legacy y verificar que no usa la ruta canary.

## 5. Runbook de mantenimiento y rollback

| Tiempo | Acción | Aborto |
|---|---|---|
| T−30 | MASTER confirma ventana, hashes, identidad exacta y responsables. | Falta cualquier hash/owner: NO-GO. |
| T−20 | Pausar altas nuevas; dejar cola estable; no apagar aún fallback local. | Requests mutándose: abortar. |
| T−10 | Apagar sólo el polling local autorizado y tomar checkpoint final DB/Storage. | Checkpoint no verificable: abortar. |
| T0 | Aplicar UP revisada una sola vez, con paused/kill activo y dispatcher off. | Error DDL, lock inesperado o diff: rollback de transacción y abortar. |
| T+5 | Ejecutar queries postflight DB/RLS/Storage; comprobar cero GPU. | Cualquier discrepancia: DOWN sólo según guardas; restaurar fallback. |
| T+15 | Desde la sesión administrativa autorizada, ejecutar el armado de exactamente un UUID mediante `arm_production_canary_uuid`; nunca usar `service_role` para armar. Habilitar una invocación canary. | No spawn, ACK ambiguo, lease vencido, hash o costo inesperado: kill switch. |
| T+30 | Validar resultado y volver a paused/kill. Sólo MASTER puede autorizar 2–4 más, uno por vez. | Nunca habilitar cola general. |
| T+45 | Checkpoint final y reporte. | Diferencia no explicada: NO-GO permanente hasta revisión. |

Rollback: activar kill switch, impedir nuevos receipts, esperar/confirmar cero
leases y estados ambiguos, limpiar sólo artefactos con ownership/hash verificado,
confirmar cero `_staging` y cero huérfanos canónicos. Ejecutar en este orden:
`0003_production_canary_single_uuid.down.sql` y, sólo si sus guardas pasan,
`0002_modal_worker_controlled_staging.down.sql`; nunca invertir el orden.
Restaurar grants/policies desde snapshot y revalidar el worker local. El DOWN
se niega si hay leases, receipts `spawning/acknowledged`, artefactos
staged/committed privados u objetos canónicos huérfanos. Nunca borrar
manualmente para vencer una guarda.

## 6. GO/NO-GO y riesgos

GO de preparación local: tests y revisión estática sin bloqueantes, archivos sin
secretos, diff limpio de formato, allowlist vacía y producción intacta.
NO-GO para ejecutar: identidad productiva no fijada por MASTER, backups sin
integridad verificada, inventario remoto faltante, SQL no revisado contra datos
reales, cualquier lease/objeto inesperado, dispatcher/trigger general activo,
polling, costo no acotado, falta de rollback o cualquier hallazgo Critical/High/
Medium. Los hallazgos residuales actuales son: no se verificaron datos/roles/
Storage remotos; no se ensayó restore remoto; no existe allowlist productiva;
no se desplegó ni ejecutó GPU. Todos son bloqueantes operativos, no evidencia
de cambio aplicado.

## 7. Archivos y recomendación

Nuevos/adaptados: `apps/worker/piano_worker/controlled.py`,
`apps/worker/tests/test_controlled_worker.py`,
`scripts/production-canary/identity-allowlist.json`,
`benchmarks/modal/controlled_migration/production_canary_worker.py` y este
runbook. Los cambios previos del usuario en `docs/DECISIONS.md` y
`docs/PROJECT_STATE.md` se preservan.

Recomendación al MASTER: aceptar el paquete como readiness local, mantener
**NO-GO** para cualquier ejecución, y exigir primero la revisión de este
inventario, la identidad exacta, un backup con integridad verificada y una
autorización separada para la ventana.
