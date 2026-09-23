# Estado del proyecto

Actualizado: 2026-09-23

## Fase actual

**SUBSCRIPTIONS ARCHITECTURE READY (flag off)** — Practice/Plus webhook `IdSuscripcion` + period grants + daily reconcile. Mini Pack sandbox intacto. Cancel individual sigue limitación Wompi. Modal/player intactos.

### Estado operativo

- Migrations 0002–0014 en producción; **0015** (status/reconcile/dedicated_enlace) lista para aplicar.
- Mini Pack sandbox (`BILLING_ENABLED=true`, `WOMPI_EXPECT_PRODUCTIVE=false`).
- Practice/Plus: código settlement listo; UI Coming soon; `BILLING_SUBSCRIPTIONS_ENABLED=false`.
- Cron: `/api/billing/reconcile-subscriptions` diario (snapshot only).

## Arquitectura billing

```
Wompi charge → webhook HMAC → IdSuscripcion / commerce_link
  → TransaccionCompra S2S → settle (purchase OR subscription period grant)
Daily reconcile → snapshot/status; NEVER invent grants
```

Detalle: [`WOMPI_INTEGRATION.md`](WOMPI_INTEGRATION.md). DEC-017.

## Último trabajo completado

2026-09-23: Incorporar respuesta soporte Wompi (estados 0–4, IdSuscripcion, no cancel individual, no sandbox renewal). Settlement compartido + reconcile diario. Migration 0015.

2026-09-21: Beta UX Pianissimo + tutorial polish.

## Siguiente tarea

Aplicar migration **0015** en Supabase. Canary real Practice/Plus solo tras decisión explícita (flags + negocio productivo). Cancel: evaluar one-link-per-sub en canary controlado.
