# Decisiones de producto y escalamiento

Este registro resume decisiones transversales. Las decisiones técnicas históricas detalladas permanecen en [`docs/decisions/`](decisions/).

## DEC-001

**Fecha:** 2026-09-18
**Decisión:** Priorizar la aplicación web/PWA antes que aplicaciones nativas.
**Motivo:** Permite validar demanda, conversión y retención con menor costo y mayor velocidad.
**Alternativas:** Aplicaciones iOS/Android desde esta etapa.
**Estado:** Aceptada; la capacidad PWA instalable todavía no está implementada.

## DEC-002

**Fecha:** 2026-08-31
**Decisión:** Mantener High-Resolution Piano Transcription como engine principal, mediante `piano_transcription_inference==0.0.6`.
**Motivo:** La calidad ya fue validada en el MVP y el modelo tiene consumo moderado de RAM/VRAM.
**Alternativas:** Basic Pitch u otro modelo AMT, únicamente tras una comparación de calidad.
**Estado:** Aceptada. Detalle en [`0001-use-high-resolution-piano-transcription.md`](decisions/0001-use-high-resolution-piano-transcription.md).

## DEC-003

**Fecha:** 2026-09-18
**Decisión:** Continuar la prueba de worker cloud con Modal T4 como GPU inicial.
**Motivo:** En el benchmark de una canción de 193.608 s, T4 caliente completó en 16.504 s por ~$0.00329; L4 tardó 17.197 s y costó ~$0.00442. Ambas produjeron 1,356 notas, 217 pedales, cero eventos descartados y resultados compatibles con el baseline. T4 fue 34.6% más barata y aproximadamente 4.0% más rápida en caliente.
**Alternativas:** L4, descartada para la configuración inicial por costo y latencia observados; RunPod Serverless permanece como fallback si Modal falla en integración u operación. Una GPU dedicada sólo se evaluará con utilización sostenida.
**Estado:** Validada end-to-end. Modal T4 procesó un request explícito de Supabase una sola vez, publicó un contrato válido y dejó cero recursos activos. Se autoriza diseñar la migración controlada, no activarla. Evidencia en [`benchmarks/modal/README.md`](../benchmarks/modal/README.md) y [`WORKER_POC_RESULT.md`](../benchmarks/modal/WORKER_POC_RESULT.md).

## DEC-004

**Fecha:** 2026-09-18
**Decisión:** Mantener Supabase como candidato para Auth, PostgreSQL y metadata, y evaluar Cloudflare R2 para objetos pesados.
**Motivo:** Separar datos relacionales de audio/resultados puede reducir costos de almacenamiento y egreso al escalar.
**Alternativas:** Continuar con Supabase Storage o elegir otro object storage tras medir costos.
**Estado:** Propuesta; no implementada.

## DEC-005

**Fecha:** 2026-09-18
**Decisión:** Usar como hipótesis inicial un preview gratuito que procese físicamente sólo los primeros 60 segundos.
**Motivo:** Permite demostrar calidad sin pagar el costo de procesar la canción completa y limita abuso.
**Alternativas:** Preview de 30 segundos o trial completo con otros límites.
**Estado:** Hipótesis activa; no implementada.

## DEC-006

**Fecha:** 2026-09-18
**Decisión:** Escalar mediante cambios pequeños, medidos y reversibles, sin reescribir el MVP ni ejecutar varias fases a la vez.
**Motivo:** El producto ya funciona; el riesgo principal de esta etapa es introducir costo y regresiones antes de validar demanda.
**Alternativas:** Rediseño integral o migración simultánea de frontend, storage, compute y billing.
**Estado:** Aceptada.

## DEC-007

**Fecha:** 2026-09-18
**Decisión:** Medir y vender creación de tutoriales mediante créditos; la reproducción de tutoriales existentes no consumirá créditos.
**Motivo:** La transcripción es la operación costosa, mientras que practicar sobre un resultado existente tiene costo marginal bajo.
**Alternativas:** Cobro por tiempo de uso o límites diarios/semanales.
**Estado:** Hipótesis comercial; precios y reglas definitivas pendientes de validación.

## DEC-008

**Fecha:** 2026-09-18
**Decisión:** Diseñar la migración del worker a Modal con despacho explícito por UUID y conservar el worker local como fallback; no habilitar todavía polling cloud ni tráfico de producción.
**Motivo:** El POC completó un request real de Supabase por $0.00756416, pero confirmó que descarga, publicación de objetos, `upsert` de `songs` y transición final del request son efectos distribuidos. Antes de operar continuamente se necesitan idempotencia, compensación observable, límites de gasto y rollback.
**Alternativas:** Activar inmediatamente un consumidor continuo en Modal; mantener indefinidamente la PC como único worker.
**Estado:** Hardening local aprobado por seguridad el 2026-09-19 tras una revisión final con 0 Critical, 0 High y 0 Medium. La ruta de proyecto staging separado fue cancelada y sustituida por DEC-009. Producción continúa desautorizada hasta otra aprobación explícita.

## DEC-009

**Fecha:** 2026-09-19
**Decisión:** No crear por ahora un proyecto Supabase staging separado. Preparar una migración controlada directa sobre el proyecto productivo existente, dentro de una ventana corta de mantenimiento, cerrada por defecto y limitada a un UUID explícito seguido de 2–3 canaries adicionales como máximo. Esta decisión autoriza planificación y preparación local; la ejecución queda concentrada y limitada por DEC-010.
**Motivo:** La aplicación es privada, tiene prácticamente una usuaria, tolera una ventana breve y conserva el worker local como fallback. Mantener otro proyecto Supabase sólo para esta validación consumiría la capacidad gratuita disponible o introduciría un costo desproporcionado para la etapa actual.
**Guardas obligatorias:** backup lógico verificable de DB; inventario y copia de Storage afectado; inventario SQL exacto; kill switch activo después de crear el control mediante 0002; dispatcher desactivado y sin trigger general; worker local preservado; migración reversible; validación DB/RLS/Storage antes de GPU; Modal T4 con `min_containers=0`, `max_containers=1`, `max_inputs=1`, `retries=0`; cero polling; un UUID armado; monitoreo de costo/estados/objetos/logs; aborto y rollback ante cualquier inconsistencia; procesamiento general de la cola desautorizado.
**Alternativas:** proyecto staging temporal; upgrade de Supabase; mantener indefinidamente el worker local; usar branching/preview cuando el costo y la escala lo justifiquen.
**Estado:** Readiness completado por 01G con GO técnico. La ejecución sigue pendiente de iniciar expresamente `02 - CONTROLLED PRODUCTION MIGRATION`; no autoriza procesamiento general.

## DEC-010

**Fecha:** 2026-09-19
**Decisión:** Consolidar precheck final, ventana de mantenimiento, migraciones 0002/0003, validación, despliegue cerrado de Modal, un canary, dos o tres canaries adicionales y rollback en un único hilo `02 - CONTROLLED PRODUCTION MIGRATION`, usando puntos internos de parada en lugar de abrir 01H–01K.
**Motivo:** La aplicación tiene uso privado y mínimo, acepta una ventana breve y conserva el worker local como fallback. El baseline productivo fue inventariado; el dump PostgreSQL custom y los seis objetos de Storage fueron respaldados y verificados. Dividir cada paso remoto en un hilo distinto ya no reduce materialmente el riesgo.
**Riesgo residual aceptado:** No se ensayó una restauración completa. El dump pasó `pg_restore --list`, tiene SHA-256 verificado y se preservó el snapshot de catálogo/grants/policies. Si el DOWN no basta, cualquier restore requerirá autorización de recuperación separada.
**Paradas obligatorias:** STOP si cambia el baseline; si existen requests/leases activos; si los hashes no coinciden; si falla 0002/0003 o cualquier invariante DB/RLS/Storage; si el control no queda `paused` con kill switch activo; si existe GPU previa no explicada; o si cualquier canary deja estado ambiguo, duplicados, artefactos pendientes o costo inesperado.
**Límite de autorización:** El hilo 02 puede ejecutar únicamente la migración cerrada y los canaries indicados. No puede habilitar procesamiento general, hacer push ni omitir rollback ante inconsistencia sin una decisión posterior del MASTER.
**Estado:** Aceptada. 01G cerrado con GO técnico; 02 preparado pero todavía no iniciado.

## DEC-011

**Fecha:** 2026-09-21
**Decisión:** Cerrar `02 - CONTROLLED PRODUCTION MIGRATION` tras un único canary production-canary validado end-to-end en Modal T4.
**Motivo:** El UUID `ceec6e6e-29ac-4289-bf06-61b967140817` llegó a `done` mediante Supabase → Modal T4 → Storage, con un único song, duración `193.608 s`, 1,356 notas, 217 pedales y cero eventos descartados. Se verificaron ownership, hashes, artifacts, `_staging=0`, outbox/leases cerrados, costo settled y cero recursos activos.
**Estado:** Completada. El sistema queda `paused` con kill switch activo; dispatcher sin trigger general y procesamiento general todavía deshabilitado. Deuda no bloqueante: los retries posteriores a compensación pueden requerir reutilización formal de rutas `cleaned`; no se implementó por la escala actual.
