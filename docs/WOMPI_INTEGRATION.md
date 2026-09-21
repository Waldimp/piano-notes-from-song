# Wompi Integration (Pianissimo)

Fecha: 2026-09-21  
Estado: **preparación lista** — Mini Pack checkout + webhook fail-closed.  
Sin cobros productivos hasta `BILLING_ENABLED=true` + credenciales sandbox.

Documentación oficial usada:

- https://docs.wompi.sv/
- https://docs.wompi.sv/autenticacion/autenticacion
- https://docs.wompi.sv/metodos-api/enlace-de-pago
- https://docs.wompi.sv/metodos-api/crear-enlace-pago-recurrentes
- https://docs.wompi.sv/webhook/definicion-webhook
- https://docs.wompi.sv/webhook/validar-webhook
- https://docs.wompi.sv/metodos-api/transaccion_prueba
- https://docs.wompi.sv/redirect-url/parametros-de-url-de-redirect
- https://docs.wompi.sv/metodos-api/obtener-transaccion-compra-por-id

## Arquitectura

```
Frontend (product_code only)
  → POST /api/billing/checkout (session JWT)
  → billing_purchases (pending) + POST https://api.wompi.sv/EnlacePago
  → redirect urlEnlace (UI alojada por Wompi)
  → Wompi POST /api/billing/wompi/webhook (header wompi_hash)
  → HMAC(raw body, API Secret) + GET /TransaccionCompra/{id}
  → settle_billing_purchase → account_entitlements + user_credit_ledger (purchase_grant)
```

**Fuente de verdad de créditos/plan:** Postgres (`account_entitlements`, `user_credit_ledger`).  
Wompi es solo payment processor. Nunca: frontend → “pagué” → créditos.

Redirect `/billing/return` **no** otorga créditos.

## Tablas (migration `0012_wompi_billing.sql`)

| Tabla | Rol |
|---|---|
| `billing_products` | Catálogo precio/créditos/tipo |
| `billing_purchases` | Checkout interno + estados pending/paid/failed/refunded/cancelled |
| `billing_events` | Webhooks crudos + idempotencia `(provider, external_event_key)` |
| `billing_subscriptions` | Preparado; lifecycle recurrente **bloqueado** |

Reutilizado sin rediseño: `plan_limits`, `account_entitlements`, `user_credit_ledger` (+ reason `purchase_grant`).

RLS: usuario puede **leer** productos y sus purchases/subscriptions; **no** puede escribir status/provider ids.

## Product mapping

| product_code | Tipo | Precio USD | Créditos | plan_code | Checkout |
|---|---|---:|---:|---|---|
| `mini_pack` | one_time | 2.99 | 5 | mini | EnlacePago (cuando BILLING_ENABLED) |
| `practice` | subscription | 5.99 | 20 | practice | Feature-flagged |
| `plus` | subscription | 8.99 | 50 | plus | Feature-flagged |

Precios centralizados en SQL + espejo `apps/web/src/lib/billing/catalog.ts`.

## Mini Pack checkout

1. Auth requerida.
2. Server resuelve monto/créditos desde catálogo.
3. Crea `billing_purchases` con `commerce_link_id` opaco único (`identificadorEnlaceComercio`).
4. `POST /EnlacePago` con `esMontoEditable=false`, `esCantidadEditable=false`, `cantidadMaximaPagosExitosos=1`, `urlRedirect`, `urlWebhook`.
5. Devuelve solo `url_enlace` (+ purchase_id).

## Webhook lifecycle

1. Leer **raw body** exacto.
2. Validar header `wompi_hash` = HMAC-SHA256(body, API Secret) con comparación constant-time.
3. Insertar `billing_events` idempotente por `IdTransaccion`.
4. Rechazar si `EsProductiva` ≠ `WOMPI_EXPECT_PRODUCTIVE`.
5. Rechazar si `Aplicativo.Id` ≠ `WOMPI_APLICATIVO_ID`.
6. Localizar purchase por `EnlacePago.IdentificadorEnlaceComercio`.
7. Confirmar S2S `GET /TransaccionCompra/{IdTransaccion}`: `esAprobada`, `esReal`, monto.
8. `settle_billing_purchase` → +créditos una sola vez (`settled_at` + unique tx).

## Idempotencia

- Unique `(provider, external_event_key)` en events (`IdTransaccion`).
- Unique `(provider, external_transaction_id)` en purchases.
- `settle_billing_purchase` es no-op si ya `settled_at`.

## Refunds (política documentada, no implementada)

Si un Mini Pack se reembolsa después de `purchase_grant`:

1. Marcar purchase `refunded` (admin/service).
2. Si `credit_balance >= credits_granted` → debitar y ledger `admin_adjust` negativo.
3. Si créditos ya consumidos → **no** inventar balance negativo automático; registrar deuda/`metadata.refund_owed` y revisión manual.

## Recurrentes (Practice / Plus) — bloqueado

Documentado en Wompi:

- `POST /EnlacePagoRecurrente` crea un **enlace de suscripción compartible**.
- Existen GET lista de suscritos, desactivar/editar enlace.

**No confirmado de forma segura en docs usadas:**

- evento webhook por renovación individual de un suscriptor;
- evento por fallo de renovación individual;
- cancelación de un suscriptor desde nuestra app con efecto en créditos/periodo.

Por eso:

- UI Practice/Plus = “Payments setup in progress”.
- `BILLING_SUBSCRIPTIONS_ENABLED` default false.
- Adapter `createEnlacePagoRecurrente` existe; **no** hay grant automático de renovación.

## Auth / env (nombres oficiales)

| Env | Origen panel/docs |
|---|---|
| `WOMPI_CLIENT_ID` | App ID del negocio (= OAuth `client_id`) |
| `WOMPI_CLIENT_SECRET` | API Secret (= OAuth `client_secret` + HMAC webhook) |
| `WOMPI_APLICATIVO_ID` | Opcional; defaults a App ID (docs: clientIdApi ≈ idAplicativo) |
| `WOMPI_AUDIENCE` | fijo `wompi_api` |
| `WOMPI_TOKEN_URL` | `https://id.wompi.sv/connect/token` |
| `WOMPI_API_BASE_URL` | `https://api.wompi.sv` |
| `WOMPI_EXPECT_PRODUCTIVE` | `false` sandbox / `true` prod |
| `BILLING_ENABLED` | feature flag checkout |
| `NEXT_PUBLIC_APP_URL` | base para redirect/webhook |

Ver `.env.example`.

## Dónde configurar (sandbox E2E)

Proyecto Vercel: **`piano-notes-from-song`** (alias `https://piano-notes-from-song.vercel.app`).

Variables **server-only** (Production + Preview; nunca `NEXT_PUBLIC_*` excepto la URL pública):

| Variable | Target | Notas |
|---|---|---|
| `WOMPI_CLIENT_ID` | Production (+ Preview si se prueba ahí) | App ID panel |
| `WOMPI_CLIENT_SECRET` | idem | API Secret — **Secret**, no loggear |
| `WOMPI_APLICATIVO_ID` | idem | Id negocio |
| `WOMPI_EXPECT_PRODUCTIVE` | idem | `false` mientras el aplicativo esté en desarrollo |
| `BILLING_ENABLED` | idem | `true` solo mientras se valide sandbox |
| `NEXT_PUBLIC_APP_URL` | idem | `https://piano-notes-from-song.vercel.app` |

Defaults fijos (opcionales): `WOMPI_AUDIENCE=wompi_api`, `WOMPI_TOKEN_URL=https://id.wompi.sv/connect/token`, `WOMPI_API_BASE_URL=https://api.wompi.sv`.

Tras añadir env vars: **redeploy** para que checkout/webhook las vean.

Webhook público: `https://piano-notes-from-song.vercel.app/api/billing/wompi/webhook`

Helper: `python scripts/production-canary/e2e_wompi_mini_pack.py --check-config`

## Estado E2E Mini Pack (2026-09-21)

**Sandbox E2E PASSED** (aplicativo en modo desarrollo; sin cobro real).

| Campo | Valor |
|---|---|
| purchase_id | `5913c4ec-56a2-4948-8e56-2a0796556382` |
| tx (parcial) | `88c8ed50-…-61df946d2765` |
| enlace | `4415845` |
| environment | development (`EsProductiva`/prueba) |
| credits | before **3** → after **8** (+5 una vez) |
| webhook | `billing_events` processed, `signature_valid=true` |
| duplicate settle | `already_settled`, balance sigue 8, 1× `purchase_grant` |
| redirect | `/billing/return` no otorga créditos por sí solo |

Credenciales: `WOMPI_CLIENT_ID` + `WOMPI_CLIENT_SECRET` en Vercel Production.  
`WOMPI_APLICATIVO_ID` **opcional** (defaults a App ID; docs: clientIdApi ≈ idAplicativo).  
`BILLING_ENABLED=true`, `WOMPI_EXPECT_PRODUCTIVE=false`, `NEXT_PUBLIC_APP_URL=https://piano-notes-from-song.vercel.app`.

Practice/Plus siguen deshabilitados. Cutover a productivo: ver sección abajo — **no hecho**.

Helper: `python scripts/production-canary/e2e_wompi_mini_pack.py --check-config`

## Checklist sandbox

- [x] Negocio en **modo desarrollo** en panel.wompi.sv
- [x] App ID / API Secret en Vercel
- [x] Env + `WOMPI_EXPECT_PRODUCTIVE=false`, `BILLING_ENABLED=true`
- [x] Migration `0012` aplicada
- [x] Webhook URL usada en EnlacePago
- [x] Mini Pack de prueba exitoso (+5 una vez)
- [x] Duplicate settle no duplica créditos
- [x] Redirect no cambia balance por sí solo
- [ ] Decidir si dejar `BILLING_ENABLED=true` en Production (sandbox) o volver a `false` hasta go-live

## Cutover development → production (NO hacer todavía)

1. En panel Wompi, pasar el negocio a productivo (o usar App ID/Secret productivos distintos).
2. En Vercel: `WOMPI_EXPECT_PRODUCTIVE=true` + credenciales productivas.
3. Redeploy.
4. Verificar que webhooks `EsProductiva=false` se rechazan (`wrong_environment`).
5. Mantener `BILLING_SUBSCRIPTIONS_ENABLED=false` hasta lifecycle recurrente.
6. Smoke test Mini Pack real con monto mínimo controlado + Terms/Privacy.

## Checklist producción

- [ ] Negocio productivo; `WOMPI_EXPECT_PRODUCTIVE=true`
- [ ] Credenciales productivas distintas del sandbox
- [ ] Rechazo de eventos `EsProductiva=false`
- [ ] Monitoreo `billing_events.rejection_reason`
- [ ] Terms/Privacy
- [ ] No habilitar subscriptions hasta lifecycle recurrente documentado

## Endpoints

| Método | Path | Notas |
|---|---|---|
| POST | `/api/billing/checkout` | Auth; `product_code` |
| POST | `/api/billing/wompi/webhook` | Raw body + `wompi_hash` |
| GET | `/api/billing/status` | Own catalog/usage/purchases |
| UI | `/pricing`, `/billing/return`, `/account` | Return **no** afirma éxito |

## Qué sacar del panel Wompi

1. **App ID** → `WOMPI_CLIENT_ID`
2. **API Secret** → `WOMPI_CLIENT_SECRET`
3. **Id del negocio / aplicativo** → `WOMPI_APLICATIVO_ID`
4. Confirmación de modo desarrollo vs productivo
5. (Opcional más adelante) ids de `EnlacePagoRecurrente` pre-creados para Practice/Plus