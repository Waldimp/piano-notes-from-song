# Estado del proyecto

Actualizado: 2026-09-18

## Fase actual

**Fase 3 — Diseño de migración controlada del worker (pendiente de iniciar).** La prueba end-to-end en Modal T4 terminó correctamente. No hay migración ni tráfico de producción activos.

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

2026-09-18: POC end-to-end del worker en Modal T4 completado. Un request explícito pasó de `queued` a `done`, publicó el contrato actual con 1,356 notas y 217 pedales, y la ejecución exitosa costó $0.00756416. Evidencia en [`benchmarks/modal/WORKER_POC_RESULT.md`](../benchmarks/modal/WORKER_POC_RESULT.md).

## Trabajo en curso

Ningún cambio funcional ni de producción. El POC quedó cerrado, sin contenedores o GPUs activos; el worker local sigue sin cambios.

## Siguiente tarea

Producir un diseño revisable de migración controlada: dispatcher por UUID, máquina de estados/idempotencia, compensación ante publicación parcial, observabilidad, límites de gasto, rollback y convivencia con el worker local. No implementarlo ni activarlo todavía.

## Blockers

No hay blocker para continuar el diseño. Antes de producción faltan un dispatcher explícito, compensación de efectos distribuidos, observabilidad y límites de gasto automatizados.
