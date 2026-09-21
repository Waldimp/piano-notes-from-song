# Estado del proyecto

Actualizado: 2026-09-20

## Fase actual

**Fase 3C — `02 - CONTROLLED PRODUCTION MIGRATION` completada.** El hardening local terminó con 0 Critical, 0 High y 0 Medium. `01G - PRODUCTION PREFLIGHT & BACKUP` cerró con GO técnico: baseline compatible, backup PostgreSQL y copia de Storage verificados, inventario SQL completo y rollback preparado. `02` ya se ejecutó con puntos internos de parada y no habilitó procesamiento general.

### Estado operativo

- Migrations 0002–0007 aplicadas en producción.
- Modal T4 `production-canary` desplegado y validado con un canary real exitoso.
- `worker_control.mode=paused`.
- `kill_switch=true`.
- Dispatcher general deshabilitado.
- Modal con 0 GPU y 0 contenedores activos.
- Worker local disponible como fallback.
- Procesamiento general Modal pendiente de autorización explícita.

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

## Preflight 01G (histórico)

2026-09-19: `01G - PRODUCTION PREFLIGHT & BACKUP` cerró con GO técnico. Se confirmó PostgreSQL 17.6, tres requests `done`, cero `processing`, ausencia de colisiones con 0002/0003 y baseline compatible. El dump custom de PostgreSQL mide 298,246 bytes, tiene SHA-256 `c5f6e392516b75bba8569ac80f99b6ce0a5afb177b354471f04f6a5e2da950ad` y pasó `pg_restore --list`. Se respaldaron seis objetos de Storage por 8,184,488 bytes; el manifiesto tiene SHA-256 `4952a0fc76587f41470f67ddf51f35d870206489b1a363c395b96e8cc87a78ad`. No se ensayó un restore completo; ese riesgo residual fue aceptado. Ese preflight fue de sólo lectura. La modificación posterior de producción (migrations 0002–0007 y el canary) corresponde al cierre de 02, no a 01G.

## Último trabajo completado

2026-09-21: `02 - CONTROLLED PRODUCTION MIGRATION` cerrado con un canary production-canary exitoso. El UUID `ceec6e6e-29ac-4289-bf06-61b967140817` completó el pipeline Supabase → Modal T4 → Storage → `done`: creó exactamente un song, duración `193.608 s`, `1,356` notas, `217` pedales y `0` eventos descartados. Se verificaron ownership, rutas y SHA-256 de artifacts, cero `_staging`, outbox cerrado, lease cerrado, costo settled y cero recursos Modal/GPU activos. El control quedó en `mode=paused`, `kill_switch=true`; el dispatcher no tiene trigger general y el procesamiento general sigue deshabilitado.

Deuda no bloqueante: los retries posteriores a una compensación pueden requerir reutilización formal de rutas `cleaned`; no se implementó todavía por la escala actual.

## Fase 3 reorganizada

### Fase 3A — Hardening local

1. Corregir todos los Critical/High y el Medium bloqueante sin usar infraestructura remota.
2. Añadir pruebas locales para aislamiento fail-closed, ACL/RLS, estados, carreras, spawn/ACK ambiguo, publisher compensable y rollback.
3. Mantener intactos producción, el worker local funcional, frontend, Storage y jobs reales.
4. Ejecutar una segunda revisión estática. Sólo un resultado sin bloqueantes permite pasar a 3B.

### Fase 3B — Readiness para producción controlada — completada

Sin tocar infraestructura remota:

1. Inventariar cada objeto que crea, altera, reemplaza o elimina la migración UP/DOWN, incluyendo grants, RLS, triggers, funciones `SECURITY DEFINER`, índices y policies de Storage.
2. Adaptar localmente las guardas que hoy fijan `staging`: identidad exacta del proyecto productivo, un Modal Environment dedicado a canaries, nombres de variables y allowlist/fingerprint revisados. No se permite eliminar la validación fail-closed ni reutilizar variables genéricas.
3. Preparar backup lógico verificable de PostgreSQL, inventario y copia de los objetos Storage afectados, export de configuración/policies y hashes; validar la integridad del dump mediante `pg_restore --list`. El ensayo completo de restauración queda como riesgo residual explícito aceptado, no como requisito de esta fase.
4. Preparar runbook minuto a minuto, queries de invariantes, criterios de aborto, responsables y ventana de mantenimiento.
5. Ejecutar revisión final de seguridad y operación. Sólo entonces el MASTER puede autorizar la ventana.

### Fase 3C — `02 - CONTROLLED PRODUCTION MIGRATION` — completada

Un único hilo ejecutó durante una ventana corta de mantenimiento, con STOP interno ante cualquier inconsistencia:

1. detener nuevas altas de trabajo y dejar la cola estable;
2. apagar el polling del worker local, conservándolo listo como fallback;
3. tomar y verificar el checkpoint final de DB y Storage;
4. aplicar 0002 y luego 0003 una sola vez; 0002 debe crear `worker_control.mode='paused'` y `kill_switch=true`, condición que se valida inmediatamente antes de continuar;
5. validar catálogo, grants, RLS, RPCs, estado de filas, rutas canónicas y denegación de `_staging` antes de desplegar o ejecutar GPU;
6. desplegar Modal T4 en un Environment canary dedicado con `min_containers=0`, `max_containers=1`, `max_inputs=1`, `retries=0`, Proxy Auth y sin polling;
7. desplegar el dispatcher sin trigger automático y mantenerlo deshabilitado;
8. armar exclusivamente un UUID real seleccionado, habilitar el camino de una sola invocación y ejecutar un canary;
9. validar DB, RLS, Storage, hashes, logs, costo, ownership, ausencia de duplicados y cero recursos activos;
10. si pasa, ejecutar sólo 2–3 UUID adicionales, uno por vez y con validación completa entre cada uno;
11. volver a modo seguro. No habilitar procesamiento general de la cola.

### Fase 3D — Decisión posterior

Presentar evidencia al MASTER. El éxito de los canaries no autoriza consumo general: habilitar la cola requerirá otra decisión explícita. Ante cualquier inconsistencia se activa rollback inmediato y se restaura el worker local.

## Necesario frente a sobreingeniería

**Necesario aun con una sola usuaria:** identidad de producción exacta y fail-closed, Modal Environment canary separado, dispatcher autenticado y desactivado por defecto, campos server-owned, ownership inmutable, claim común, un único UUID armado, reconciliación acotada de estados ambiguos, publicación idempotente/compensable, exclusión `_staging`, kill switch, tope de gasto, backup verificado y rollback preparado.

**No necesario ahora:** proyecto Supabase staging separado, staging permanente, 20 canaries por cuota fija, multi-región, más de una GPU concurrente, polling cloud, canary continuo, plataforma completa de alertas/SRE, autoscaling complejo, R2, pricing/rate limiting comercial, múltiples workers o rotación automatizada sofisticada.

**No depende de un proyecto staging:** `_staging` sigue siendo el prefijo privado y transaccional dentro de Storage; también permanecen claim/lease, ownership, HMAC/Proxy Auth, reconciliación, compensación, límites de gasto y ausencia de polling.

**Sí dependía del proyecto staging y debe cambiar antes de desplegar:** `PIANO_ENVIRONMENT='staging'`, `MODAL_ENVIRONMENT='staging'`, variables `STAGING_*`, `identity-allowlist.json`, el dispatcher y worker nombrados `staging`, el script que rechaza destinos no staging y la suposición de poder ensayar UP/DOWN/UP sobre una base vacía. En producción se reemplazan por identidad productiva exacta y revisada, un Environment Modal exclusivo para canaries y una sola aplicación de UP respaldada por backup/rollback; nunca se relajan las guardas para aceptar cualquier destino.

## Ruta mínima a una posible migración productiva

01G cerrado → `02 - CONTROLLED PRODUCTION MIGRATION` ejecutado y cerrado → canary production-canary validado → estado seguro (`mode=paused`, `kill_switch=true`, dispatcher general deshabilitado, 0 GPU/contenedores) → procesamiento general Modal pendiente de autorización explícita. No se vuelven a aplicar las migrations 0002–0007 ni se habilita la cola general sin otra decisión del MASTER.

## Siguiente tarea

No habilitar procesamiento general. Cualquier promoción de Modal más allá del canary requiere una decisión explícita posterior del MASTER.

## Commits relevantes de 02

`5357010`, `9059ee0`, `efc0879`, `5917baa` y `544b1d2` documentan el packaging del smoke, las correcciones del control-plane y la recuperación determinista usada durante el canary.
