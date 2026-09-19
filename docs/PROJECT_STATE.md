# Estado del proyecto

Actualizado: 2026-09-19

## Fase actual

**Fase 3A completada — Hardening local aprobado por seguridad; infraestructura remota bloqueada.** La revisión estática final encontró 0 Critical, 0 High y 0 Medium. La decisión operativa vigente sigue siendo NO-GO para desplegar o ejecutar staging y NO-GO para producción.

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

Ejecución remota en pausa. El código local superó la revisión de seguridad, pero todavía no está autorizado para desplegarse. La allowlist permanece intencionalmente vacía y bloquea cualquier destino hasta obtener y revisar el `project_ref` real de un proyecto temporal. `00 - PRODUCT SCALE MASTER` conserva la orquestación; el siguiente hilo será `01E - TEMPORARY STAGING BOOTSTRAP` y se limitará a provisionar identidad vacía, sin migraciones, funciones, secrets funcionales, GPU ni jobs.

## Fase 3 reorganizada

### Fase 3A — Hardening local

1. Corregir todos los Critical/High y el Medium bloqueante sin usar infraestructura remota.
2. Añadir pruebas locales para aislamiento fail-closed, ACL/RLS, estados, carreras, spawn/ACK ambiguo, publisher compensable y rollback.
3. Mantener intactos producción, el worker local funcional, frontend, Storage y jobs reales.
4. Ejecutar una segunda revisión estática. Sólo un resultado sin bloqueantes permite pasar a 3B.

### Fase 3B — Staging temporal mínimo

Crear recursos efímeros y aislados únicamente para la validación:

- un proyecto Supabase vacío, con Auth/DB/Storage y datos sintéticos;
- un Modal Environment temporal con T4, `min_containers=0`, `max_containers=1`, `max_inputs=1` y `retries=0`;
- un Secret, Proxy Auth y Volume/checkpoint exclusivos de ese Environment;
- un dispatcher server-to-server, un solo request explícito por vez y presupuesto muy bajo;
- identidad de proyecto/Environment fijada fuera de variables autoafirmadas y deny explícito de producción.

Primero se ensaya migración UP → invariantes → DOWN → UP. Después se comprueban ACL/RLS, aislamiento y cero recursos activos.

### Fase 3C — Canaries dirigidos

Ejecutar sólo los casos necesarios, secuencialmente:

1. happy path frío: Supabase → dispatcher → Modal T4 → Storage → `done`;
2. happy path caliente con un segundo UUID;
3. replay/redelivery del mismo `dispatch_id`, sin segundo efecto ni doble costo;
4. fallo recuperable de publicación o ACK ambiguo, con reconciliación demostrada;
5. kill switch, job atascado y rollback completo al worker local.

El número exacto puede ser 5–8 ejecuciones; no se requieren 20 canaries si estos casos cubren cada invariante y no aparece ningún incidente. Se registran costo, GPU-seconds, estado final, objetos, outbox y cero GPUs/contenedores al terminar.

### Fase 3D — Cierre del staging y decisión

1. Exportar evidencia sin secretos y retirar endpoint, tokens, Secret, Volume, buckets/datos y proyecto temporal cuando ya no sean necesarios.
2. Presentar resultados al MASTER.
3. Evaluar una migración productiva separada, pequeña y reversible. Esta fase no autoriza producción; requiere un nuevo GO explícito.

## Necesario frente a sobreingeniería

**Necesario aun con una sola usuaria:** separación técnica fail-closed, dispatcher autenticado, campos server-owned, ownership inmutable, claim común, un único spawn autorizado, reconciliación acotada de estados ambiguos, publicación idempotente/compensable, exclusión `_staging`, kill switch, tope de gasto y rollback probado.

**No necesario ahora:** staging permanente, 20 canaries por cuota fija, multi-región, más de una GPU concurrente, polling cloud, canary continuo, plataforma completa de alertas/SRE, autoscaling complejo, R2, pricing/rate limiting comercial, múltiples workers o rotación automatizada sofisticada. Logs estructurados, una alerta de job atascado/gasto y un runbook breve son suficientes para la validación temporal.

## Ruta mínima a una posible migración productiva

Hardening local → segunda revisión de seguridad → staging efímero aislado → UP/DOWN/UP y pruebas ACL/RLS → 5–8 canaries dirigidos → kill switch y rollback → teardown de staging → informe al MASTER → decisión Go/No-Go específica para producción → sólo con GO, canary productivo único y reversible.

## Siguiente tarea

Cerrar en Git el hardening local y preparar `01E - TEMPORARY STAGING BOOTSTRAP`. En 01E sólo se podrán crear un proyecto Supabase temporal vacío y un Modal Environment vacío para obtener sus identificadores reales. No aplicar migraciones, desplegar Edge Functions, cargar secrets funcionales, ejecutar GPU, procesar jobs ni acceder a producción.

## Blockers

Antes de desplegar staging debe existir un `project_ref` temporal real, incorporado mediante un cambio revisado a la allowlist/fingerprint, y debe autorizarse explícitamente la validación remota. Después faltan pruebas reales de PostgreSQL/RLS, ACK/replay de Modal, costo, kill switch y rollback. Producción requiere además completar los canaries dirigidos, retirar o cerrar el staging temporal y recibir una autorización MASTER explícita.
