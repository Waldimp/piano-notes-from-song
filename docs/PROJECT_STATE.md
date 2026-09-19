# Estado del proyecto

Actualizado: 2026-09-19

## Fase actual

**Fase 3B — Preparación de migración controlada directa a producción; ejecución no autorizada.** El hardening local terminó con 0 Critical, 0 High y 0 Medium. Se canceló `01E - TEMPORARY STAGING BOOTSTRAP` para no mantener otro proyecto Supabase. Producción permanece en NO-GO hasta completar y aprobar un runbook, backup verificable, inventario SQL, adaptación de las guardas y ensayo de rollback.

## Arquitectura actual

- Web Next.js en modo local (FastAPI + SQLite) o nube (Vercel + Supabase).
- Supabase aporta Auth, PostgreSQL, cola `requests` y Storage privado (`uploads`, `audio`, `notes`).
- Un worker Python en la PC consulta la cola cada 15 s, reclama jobs mediante actualización condicional y procesa uno por vez con la GPU local.
- El pipeline genera `notes.json`, MIDI y `playback.m4a`; en nube publica `notes.json` y el audio de reproducción en Supabase.

## Stack

- Next.js 15, React 19, TypeScript y Canvas 2D.
- Python 3.12, FastAPI, PyTorch 2.11.0 + CUDA 12.8 y FFmpeg.
- `piano_transcription_inference==0.0.6` con High-Resolution Piano Transcription.
- Vercel, Supabase y SQLite local.

## Estado del producto

MVP funcional y usado satisfactoriamente. El baseline del repositorio quedó verificado el 2026-09-18: 49 tests Python, 65 tests web y build de producción de Next.js correctos. Sigue siendo una aplicación privada/de baja escala; aún no está endurecida para uso comercial multiusuario.

## Decisiones activas

- Preservar el MVP y escalar por fases pequeñas y reversibles.
- Web/PWA antes que aplicaciones nativas.
- Mantener High-Resolution Piano Transcription como engine principal.
- Usar Modal T4 para diseñar la migración controlada; conservar el worker local y RunPod como fallbacks.
- No activar polling cloud: el dispatcher debe entregar UUIDs explícitos y aplicar idempotencia, compensación, observabilidad y guardas de gasto.
- Mantener Supabase para Auth/DB; R2 y el preview gratuito de 60 s siguen como decisiones candidatas por validar.

## Último trabajo completado

2026-09-19: hardening local completado. Se implementaron identidad fail-closed, autorización HMAC server-to-server, cierre de mass assignment/ownership, revalidación antes de spawn, reconciliación durable, publisher resistente a I/O ambiguo, rollback seguro y roles `SECURITY DEFINER` endurecidos. La revisión estática final cerró con 0 Critical, 0 High y 0 Medium. No se accedió a cloud ni a producción.

## Trabajo en curso

Ejecución remota en pausa. `01E - TEMPORARY STAGING BOOTSTRAP` quedó cancelado. `00 - PRODUCT SCALE MASTER` conserva la orquestación y prepara una migración directa, breve y reversible sobre el proyecto existente. `01F - PRODUCTION MIGRATION READINESS` dejó inventario SQL, adaptación `production-canary`, pruebas y runbooks en [`docs/PRODUCTION_MIGRATION_READINESS.md`](PRODUCTION_MIGRATION_READINESS.md). No se ha autorizado aplicar SQL, desplegar dispatcher/worker, cargar secrets nuevos, iniciar GPU ni procesar requests.

## Fase 3 reorganizada

### Fase 3A — Hardening local

1. Corregir todos los Critical/High y el Medium bloqueante sin usar infraestructura remota.
2. Añadir pruebas locales para aislamiento fail-closed, ACL/RLS, estados, carreras, spawn/ACK ambiguo, publisher compensable y rollback.
3. Mantener intactos producción, el worker local funcional, frontend, Storage y jobs reales.
4. Ejecutar una segunda revisión estática. Sólo un resultado sin bloqueantes permite pasar a 3B.

### Fase 3B — Readiness para producción controlada

Sin tocar infraestructura remota:

1. Inventariar cada objeto que crea, altera, reemplaza o elimina la migración UP/DOWN, incluyendo grants, RLS, triggers, funciones `SECURITY DEFINER`, índices y policies de Storage.
2. Adaptar localmente las guardas que hoy fijan `staging`: identidad exacta del proyecto productivo, un Modal Environment dedicado a canaries, nombres de variables y allowlist/fingerprint revisados. No se permite eliminar la validación fail-closed ni reutilizar variables genéricas.
3. Preparar backup lógico restaurable de PostgreSQL, inventario y copia de los objetos Storage afectados, export de configuración/policies y hashes; documentar y ensayar la restauración fuera de producción cuando sea posible.
4. Preparar runbook minuto a minuto, queries de invariantes, criterios de aborto, responsables y ventana de mantenimiento.
5. Ejecutar revisión final de seguridad y operación. Sólo entonces el MASTER puede autorizar la ventana.

### Fase 3C — Cambio productivo cerrado por defecto

Durante una ventana corta de mantenimiento:

1. detener nuevas altas de trabajo y dejar la cola estable;
2. apagar el polling del worker local, conservándolo listo como fallback;
3. tomar y verificar el checkpoint final de DB y Storage;
4. aplicar una sola vez la migración revisada con `worker_control.mode='paused'`, kill switch activo, dispatcher desactivado y gasto reservado en cero;
5. validar catálogo, grants, RLS, RPCs, estado de filas, rutas canónicas y denegación de `_staging` antes de desplegar o ejecutar GPU;
6. desplegar Modal T4 en un Environment canary dedicado con `min_containers=0`, `max_containers=1`, `max_inputs=1`, `retries=0`, Proxy Auth y sin polling;
7. desplegar el dispatcher sin trigger automático y mantenerlo deshabilitado;
8. armar exclusivamente un UUID real seleccionado, habilitar el camino de una sola invocación y ejecutar un canary;
9. validar DB, RLS, Storage, hashes, logs, costo, ownership, ausencia de duplicados y cero recursos activos;
10. si pasa, ejecutar sólo 2–4 UUID adicionales, uno por vez y con validación completa entre cada uno;
11. volver a modo seguro. No habilitar procesamiento general de la cola.

### Fase 3D — Decisión posterior

Presentar evidencia al MASTER. El éxito de los canaries no autoriza consumo general: habilitar la cola requerirá otra decisión explícita. Ante cualquier inconsistencia se activa rollback inmediato y se restaura el worker local.

## Necesario frente a sobreingeniería

**Necesario aun con una sola usuaria:** identidad de producción exacta y fail-closed, Modal Environment canary separado, dispatcher autenticado y desactivado por defecto, campos server-owned, ownership inmutable, claim común, un único UUID armado, reconciliación acotada de estados ambiguos, publicación idempotente/compensable, exclusión `_staging`, kill switch, tope de gasto, backup verificado y rollback probado.

**No necesario ahora:** proyecto Supabase staging separado, staging permanente, 20 canaries por cuota fija, multi-región, más de una GPU concurrente, polling cloud, canary continuo, plataforma completa de alertas/SRE, autoscaling complejo, R2, pricing/rate limiting comercial, múltiples workers o rotación automatizada sofisticada.

**No depende de un proyecto staging:** `_staging` sigue siendo el prefijo privado y transaccional dentro de Storage; también permanecen claim/lease, ownership, HMAC/Proxy Auth, reconciliación, compensación, límites de gasto y ausencia de polling.

**Sí dependía del proyecto staging y debe cambiar antes de desplegar:** `PIANO_ENVIRONMENT='staging'`, `MODAL_ENVIRONMENT='staging'`, variables `STAGING_*`, `identity-allowlist.json`, el dispatcher y worker nombrados `staging`, el script que rechaza destinos no staging y la suposición de poder ensayar UP/DOWN/UP sobre una base vacía. En producción se reemplazan por identidad productiva exacta y revisada, un Environment Modal exclusivo para canaries y una sola aplicación de UP respaldada por backup/rollback; nunca se relajan las guardas para aceptar cualquier destino.

## Ruta mínima a una posible migración productiva

Inventario y adaptación local → backup/restore verificado → revisión final → autorización de ventana → mantenimiento → checkpoint final → migración con kill switch y dispatcher apagados → validación DB/RLS/Storage sin GPU → deploy canary cerrado → un UUID explícito → validación → 2–4 canaries adicionales como máximo → volver a estado seguro → informe al MASTER. El procesamiento general permanece desautorizado.

## Siguiente tarea

Revisar los entregables de `01F` y mantener el resultado en **NO-GO** hasta que MASTER apruebe expresamente la identidad productiva exacta, un backup restaurado fuera de producción y una ventana de mantenimiento. No aplicar migraciones, desplegar servicios, iniciar GPU ni procesar requests.

## Blockers

La implementación endurecida está fijada a staging y no puede desplegarse directamente en producción. Antes de autorizar una ventana deben existir: backup de DB y objetos Storage con restauración verificable, inventario SQL exacto, adaptación fail-closed revisada, migración UP/DOWN compatible con datos reales, queries pre/post, dispatcher apagado por defecto, selección del UUID canary, observabilidad/costo, procedimiento de rollback y revisión final sin bloqueantes. La ausencia de cualquiera implica NO-GO.
