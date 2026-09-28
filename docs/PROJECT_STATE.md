# Estado del proyecto

Actualizado: 2026-09-27

## Fase actual

**ESTABILIZACIÓN PRE-BETA + REDISEÑO VISUAL** — deuda técnica cerrada (migraciones 0015/0016
aplicadas, uploads huérfanos limpiados con cron, wake por `pg_cron`), **FREE = vista previa de
60 s** procesada antes de la transcripción, y UI comercial nueva (Pianissimo, tipografía
Fraunces/Manrope, biblioteca de tarjetas, pricing, cuenta, reproductor). Flags de
producción sin cambio: `BILLING_ENABLED=true`, `WOMPI_EXPECT_PRODUCTIVE=false`,
`BILLING_SUBSCRIPTIONS_ENABLED` sin definir (false).

### Estado operativo

- Migrations **0002–0017** en producción (0017: preview, cleanup, wake `pg_cron`).
- Modal T4 redesplegado el 2026-09-27 con el recorte de preview (`piano_worker.preview`).
- `pg_cron` `pianissimo_wake_dispatch` cada minuto (no-op sin trabajo); secretos en Vault.
- Cron Vercel diario `/api/dispatch-wake` = wake de recuperación + limpieza de uploads.
- Requests históricas en `error` (4) son residuos de E2E del 2026-09-21 y de un test en
  vivo (`cancelled_beta_e2e*`, `test_cleanup`); la UI ya no muestra códigos internos.
- Correo de Auth: integrado de Supabase (dev-only). Resend preparado (script + doc),
  pendiente de dominio y API key.

## Último trabajo completado

2026-09-27: migraciones 0015/0016/0017, limpieza de 9 uploads, wake pg_cron + re-wake desde
el navegador, preview FREE (SQL + worker + UI + desbloqueo con crédito), rediseño completo,
docs actualizados, test en vivo aislado con `PIANO_RUN_LIVE_TESTS=1`.

2026-09-27 (noche): receipt atascado cerrado (cola sana, preview E2E `760cca4c…` procesada en
Modal), segunda pasada de diseño "escenario" (DEC-022): hero con el reproductor real, demo
interactiva, biblioteca-estantería con portadas generativas, pricing editorial, player con
chrome flotante, fuentes Instrument Serif + DM Sans, motion por CSS/IntersectionObserver.
Capturas en `docs/qa/2026-09-27/v2-*.png`.

## Siguiente tarea

1. Dominio propio + Resend (`docs/AUTH_EMAIL_RESEND.md`) → registro/recuperación fiables.
2. Cutover de Mini Pack a cobros reales cuando el negocio lo decida (`WOMPI_INTEGRATION.md`).
3. Beta cerrada con 10–20 usuarios externos midiendo activación y conversión.
