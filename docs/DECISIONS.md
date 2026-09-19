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
**Estado:** Aceptada para diseño. La implementación y activación requieren una aprobación posterior y criterios de salida explícitos.
