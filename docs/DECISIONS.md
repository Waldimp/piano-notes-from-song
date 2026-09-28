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
**Estado:** SUPERSEDED en la autorización de producción por DEC-011. Se conserva como historial: hardening local aprobado por seguridad el 2026-09-19 tras una revisión final con 0 Critical, 0 High y 0 Medium. La ruta de proyecto staging separado fue cancelada y sustituida por DEC-009. La prohibición de polling cloud y de procesamiento general sigue vigente a través de DEC-011.

## DEC-009

**Fecha:** 2026-09-19
**Decisión:** No crear por ahora un proyecto Supabase staging separado. Preparar una migración controlada directa sobre el proyecto productivo existente, dentro de una ventana corta de mantenimiento, cerrada por defecto y limitada a un UUID explícito seguido de 2–3 canaries adicionales como máximo. Esta decisión autoriza planificación y preparación local; la ejecución queda concentrada y limitada por DEC-010.
**Motivo:** La aplicación es privada, tiene prácticamente una usuaria, tolera una ventana breve y conserva el worker local como fallback. Mantener otro proyecto Supabase sólo para esta validación consumiría la capacidad gratuita disponible o introduciría un costo desproporcionado para la etapa actual.
**Guardas obligatorias:** backup lógico verificable de DB; inventario y copia de Storage afectado; inventario SQL exacto; kill switch activo después de crear el control mediante 0002; dispatcher desactivado y sin trigger general; worker local preservado; migración reversible; validación DB/RLS/Storage antes de GPU; Modal T4 con `min_containers=0`, `max_containers=1`, `max_inputs=1`, `retries=0`; cero polling; un UUID armado; monitoreo de costo/estados/objetos/logs; aborto y rollback ante cualquier inconsistencia; procesamiento general de la cola desautorizado.
**Alternativas:** proyecto staging temporal; upgrade de Supabase; mantener indefinidamente el worker local; usar branching/preview cuando el costo y la escala lo justifiquen.
**Estado:** SUPERSEDED por DEC-011. Se conserva como historial: readiness completado por 01G con GO técnico. La ejecución de `02 - CONTROLLED PRODUCTION MIGRATION` ya no está pendiente; DEC-011 la cierra. Sigue sin autorizar procesamiento general.

## DEC-010

**Fecha:** 2026-09-19
**Decisión:** Consolidar precheck final, ventana de mantenimiento, migraciones 0002/0003, validación, despliegue cerrado de Modal, un canary, dos o tres canaries adicionales y rollback en un único hilo `02 - CONTROLLED PRODUCTION MIGRATION`, usando puntos internos de parada en lugar de abrir 01H–01K.
**Motivo:** La aplicación tiene uso privado y mínimo, acepta una ventana breve y conserva el worker local como fallback. El baseline productivo fue inventariado; el dump PostgreSQL custom y los seis objetos de Storage fueron respaldados y verificados. Dividir cada paso remoto en un hilo distinto ya no reduce materialmente el riesgo.
**Riesgo residual aceptado:** No se ensayó una restauración completa. El dump pasó `pg_restore --list`, tiene SHA-256 verificado y se preservó el snapshot de catálogo/grants/policies. Si el DOWN no basta, cualquier restore requerirá autorización de recuperación separada.
**Paradas obligatorias:** STOP si cambia el baseline; si existen requests/leases activos; si los hashes no coinciden; si falla 0002/0003 o cualquier invariante DB/RLS/Storage; si el control no queda `paused` con kill switch activo; si existe GPU previa no explicada; o si cualquier canary deja estado ambiguo, duplicados, artefactos pendientes o costo inesperado.
**Límite de autorización:** El hilo 02 puede ejecutar únicamente la migración cerrada y los canaries indicados. No puede habilitar procesamiento general, hacer push ni omitir rollback ante inconsistencia sin una decisión posterior del MASTER.
**Estado:** SUPERSEDED por DEC-011. Se conserva como historial: 01G cerrado con GO técnico. El hilo 02 ya no está preparado y sin iniciar; DEC-011 lo da por cerrado tras el canary. El límite de no habilitar procesamiento general permanece.

## DEC-011

**Fecha:** 2026-09-21
**Decisión:** Cerrar `02 - CONTROLLED PRODUCTION MIGRATION` tras un único canary production-canary validado end-to-end en Modal T4.
**Motivo:** El UUID `ceec6e6e-29ac-4289-bf06-61b967140817` llegó a `done` mediante Supabase → Modal T4 → Storage, con un único song, duración `193.608 s`, 1,356 notas, 217 pedales y cero eventos descartados. Se verificaron ownership, hashes, artifacts, `_staging=0`, outbox/leases cerrados, costo settled y cero recursos activos.
**Estado:** SUPERSEDED por DEC-012. Se conserva como historial del cierre canary. El procesamiento general Modal quedó autorizado y validado por DEC-012.

## DEC-012

**Fecha:** 2026-09-21
**Decisión:** Habilitar procesamiento Modal general controlado reutilizando outbox + `acquire_next_modal_dispatch` + Edge Function wake + Modal T4 existente, sin polling desde Modal y conservando el worker local como fallback.
**Motivo:** El canary demostró el pipeline end-to-end; el gap era solo la selección server-side de UUIDs elegibles y un despertador autenticado. Tres jobs reales (incluyendo prueba de pausa) completaron `done` con un song cada uno, sin `_staging`, outbox cerrada y GPU en cero al finalizar.
**Estado:** Vigente. Wake primario vía create-request server-side + `/api/wake-dispatch`. Cron Hobby diario = recovery. Operativo: `mode=modal`, `kill_switch=false`, hard stop USD 20, `max_containers=1`, retries automáticos deshabilitados. Deuda: naming histórico `dispatch-modal-staging`/`production-canary`.

## DEC-013

**Fecha:** 2026-09-21
**Decisión:** Preparar beta cerrada con aislamiento RLS por usuario, entitlements/créditos internos (sin PSP), FREE 3×60s, límites por plan en `plan_limits`, create-request server-side y rate/concurrency básicos en Postgres.
**Motivo:** La app era multi-usuario autenticado con policies `using (true)`; para beta real hace falta separación de datos y cuotas sin todavía integrar pagos.
**Estado:** Vigente. Ver [`BETA_READINESS.md`](BETA_READINESS.md). Branding y R2 siguen fuera de alcance. Pagos: ver DEC-014.

## DEC-014

**Fecha:** 2026-09-21
**Decisión:** Integrar Wompi El Salvador como único payment processor vía `POST /EnlacePago` (pagos únicos) y preparar `POST /EnlacePagoRecurrente` (suscripciones), sin captura de tarjeta en nuestro frontend. Créditos/entitlements permanecen en Postgres; webhooks fall-closed con HMAC `wompi_hash` + confirmación `GET /TransaccionCompra/{id}`.
**Motivo:** Necesitamos cobros reales en SV sin rediseñar el ledger beta; la UI alojada por Wompi evita PAN/CVV en Pianissimo.
**Estado:** Vigente — Mini Pack sandbox E2E passed; código production-ready. Practice/Plus feature-flagged hasta lifecycle recurrente. Ver [`WOMPI_INTEGRATION.md`](WOMPI_INTEGRATION.md).

## DEC-015

**Fecha:** 2026-09-21
**Decisión:** Declarar Mini Pack **production-ready** (legales, kill switch, checklist cutover, tests) **sin** activar cobros reales: `WOMPI_EXPECT_PRODUCTIVE=false`, negocio Wompi en desarrollo, sin flip a productivo ni compra real hasta decisión explícita posterior.
**Motivo:** Separar preparación técnica del go-live financiero reduce riesgo de cargo accidental; sandbox debe seguir usable.
**Estado:** Vigente. Checklist de activación futura en [`WOMPI_INTEGRATION.md`](WOMPI_INTEGRATION.md).

## DEC-016

**Fecha:** 2026-09-21
**Decisión:** Declarar Practice/Plus **SUBSCRIPTIONS PARTIALLY READY**: reutilizar `billing_subscriptions`, añadir period grants idempotentes (0013), adapters OpenAPI confirmados (`EnlacePagoRecurrente`, `.../suscripciones`), y **HARD BLOCK** de afiliación/grant/cancel individual hasta que Wompi documente correlación webhook↔suscriptor y cancel por afiliado. No fingir E2E ni cancel solo en DB.
**Motivo:** OpenAPI confirma listado de suscriptores y disable del enlace compartido, pero no payload de renovación ni cancel individual; otorgar créditos o cancelar localmente sería inseguro.
**Estado:** SUPERSEDED parcialmente por DEC-017 (support response). Cancel sigue bloqueado.

## DEC-017

**Fecha:** 2026-09-23
**Decisión:** Tras respuesta de soporte Wompi: mapear `EstadoSuscripcion` 0–4; correlacionar webhooks recurrentes por `IdSuscripcion`; settlement compartido `processVerifiedSubscriptionPayment` → `grant_subscription_period_credits`; reconciliación diaria secundaria sin auto-grant; arquitectura **WEBHOOK PRIMARY + DAILY RECONCILIATION SECONDARY**. Cancel individual permanece **CANCELLATION PROVIDER LIMITATION** (one-link-per-subscription candidato, no probado). Flags productivos sin cambio (`BILLING_SUBSCRIPTIONS_ENABLED=false`, `WOMPI_EXPECT_PRODUCTIVE=false`).
**Motivo:** Wompi cobra; Pianissimo verifica/contabiliza/reconcilia. Sin simulación sandbox de renovación; E2E real solo en canary futuro.
**Estado:** Vigente. Ver [`WOMPI_INTEGRATION.md`](WOMPI_INTEGRATION.md).

## DEC-018

**Fecha:** 2026-09-27
**Decisión:** El plan FREE acepta cualquier canción válida y procesa únicamente los primeros 60 segundos (vista previa), recortando el audio con FFmpeg **antes** de la transcripción. Los planes de pago conservan sus límites (10 min, rechazo `duration_exceeded`). El upload original de una preview se conserva 30 días para poder "desbloquear" la canción completa con un crédito de un plan de pago (`POST /api/unlock-song`).
**Motivo:** Rechazar canciones largas impedía probar el producto con la música que la gente realmente quiere aprender; procesar solo 60 s mantiene el costo GPU de la preview en ~1/3 del de una canción y crea un CTA natural hacia Mini Pack.
**Alternativas:** preview de 30 s (menos útil para evaluar calidad); transcribir completo y ocultar (gasta GPU en algo que no se muestra).
**Estado:** Vigente (migración 0017, `piano_worker.preview`, Modal redesplegado).

## DEC-019

**Fecha:** 2026-09-27
**Decisión:** Añadir dos fuentes de wake entre el inmediato y el cron diario: (a) el navegador re-despierta al despachador cada 30 s mientras su canción siga en cola; (b) `pg_cron` ejecuta cada minuto `wake_dispatch_if_pending()`, que solo llama a Vercel (`net.http_post`) cuando hay outbox pendiente elegible y `mode=modal` sin kill switch; secretos en Supabase Vault. Sin Database Webhook ni polling en Modal.
**Motivo:** Si el wake de `create-request` fallaba, el usuario esperaba hasta el cron diario. `pg_cron` + `pg_net` ya existen en el proyecto, no añaden costo y respetan el principio "Modal no hace polling".
**Alternativas:** Database Webhook (más rápido, pero expone un endpoint por evento y requiere HMAC por fila); polling en Modal (rechazado por costo).
**Estado:** Vigente y verificado (respuestas 200 `idle` registradas en `net._http_response`).

## DEC-020

**Fecha:** 2026-09-27
**Decisión:** Limpieza automática de `uploads`: cada día, el cron `/api/dispatch-wake` borra objetos de más de 24 h que no necesite ninguna solicitud viva, salvo previews FREE de menos de 30 días. La decisión está en SQL (`list_expired_uploads`); el borrado usa la Storage API.
**Motivo:** Storage Free es de 1 GB; los uploads se acumulaban (9 huérfanos tras los E2E) y el diseño original prometía cleanup diferido no implementado.
**Estado:** Vigente; primera pasada manual ejecutada el 2026-09-27.

## DEC-021

**Fecha:** 2026-09-27
**Decisión:** Rediseño visual completo (identidad Pianissimo: ébano cálido + dorado, Fraunces/Manrope, biblioteca de tarjetas con "Abrir tutorial" como acción primaria, pricing comercial, reproductor como pieza central) sin cambiar arquitectura ni backend, y sin secciones técnicas en producción (el panel de cola solo existe en modo local).
**Motivo:** La UI anterior parecía un MVP generado; para beta cerrada hace falta credibilidad y jerarquía visual.
**Estado:** Vigente. Correo de producción con Resend queda preparado pero pendiente de dominio (DEC pendiente de cierre en `AUTH_EMAIL_RESEND.md`).
