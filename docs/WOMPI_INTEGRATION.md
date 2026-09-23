# Wompi Integration (Pianissimo)

Fecha: 2026-09-21
Estado: **preparación lista** — Mini Pack checkout + webhook fail-closed.
Sin cobros **reales** hasta cutover explícito (`WOMPI_EXPECT_PRODUCTIVE=true` + negocio productivo en panel). Sandbox Mini Pack operativo con `BILLING_ENABLED=true` + `WOMPI_EXPECT_PRODUCTIVE=false`.

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

## Tablas (migrations `0012` + `0013`)

| Tabla | Rol |
|---|---|
| `billing_products` | Catálogo precio/créditos/tipo |
| `billing_purchases` | Checkout interno + estados pending/paid/failed/refunded/cancelled |
| `billing_events` | Webhooks crudos + idempotencia `(provider, external_event_key)` |
| `billing_subscriptions` | Practice/Plus (0013: external_subscription_id, period fields) |
| `billing_subscription_period_grants` | Idempotencia grant por periodo (0013) |

Reutilizado sin rediseño: `plan_limits`, `account_entitlements`, `user_credit_ledger` (+ reasons `purchase_grant`, `subscription_grant`).

RLS: usuario puede **leer** productos y sus purchases/subscriptions/grants; **no** puede escribir status/provider ids.

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

## WOMPI SUBSCRIPTIONS (Practice / Plus) — PRODUCTION-READY ARCHITECTURE (flag off)

Estado: **arquitectura lista** (2026-09-23). Sin cobros recurrentes reales.
`BILLING_SUBSCRIPTIONS_ENABLED=false`. `WOMPI_EXPECT_PRODUCTIVE=false`.

### WOMPI TECHNICAL SUPPORT RESPONSE (evidencia directa)

Respuestas de soporte técnico Wompi (no hay URL pública; evidencia interna):

| Tema | Respuesta |
|---|---|
| `EstadoSuscripcion` | **0 = Activa**, **1 = Suspendida**, **2 = Cancelada**, **3 = Finalizada**, **4 = NoDefinido** |
| Cancel individual | **No existe** endpoint; sólo desactivar el `EnlacePagoRecurrente` completo |
| Webhook recurrente | Contiene **`IdSuscripcion`** para correlacionar el cobro |
| Simulación sandbox renovación | **No existe**; pruebas completas requieren negocio activo + cargos reales |

### Arquitectura (WEBHOOK PRIMARY + DAILY RECONCILIATION SECONDARY)

```
Wompi recurring charge
  → signed webhook (wompi_hash)
  → IdSuscripcion
  → billing_subscriptions.external_subscription_id
  → GET /TransaccionCompra/{id} (S2S)
  → processVerifiedSubscriptionPayment(...)
  → grant_subscription_period_credits (idempotent)
  → entitlement + credit ledger

Daily cron /api/billing/reconcile-subscriptions
  → GET .../suscripciones
  → snapshot + status sync
  → RECONCILIATION_REQUIRES_REVIEW on unverifiable Δ pagosRealizados
  → NEVER grant without verified TransaccionCompra id
```

**Principio:** Wompi cobra/agenda/reintenta. Pianissimo verifica, correlaciona, acredita y reconcilia. Nunca un segundo cobro desde Pianissimo.

### EstadoSuscripcion → interno

| Raw | Label | Internal status | New grants from status alone |
|---|---|---|---|
| 0 | Activa | `active` | allowed only via verified payment path |
| 1 | Suspendida | `suspended` | no |
| 2 | Cancelada | `cancelled` | no |
| 3 | Finalizada | `finished` | no |
| 4 | NoDefinido | `undefined` | no financial auto-effects |

Raw siempre en `wompi_estado_raw`.

### Modelo

- Migrations **0012–0015** (0015: statuses + `dedicated_enlace` + `reconciliation_status`)
- Shared settlement: `processVerifiedSubscriptionPayment` (webhook; future verified recovery)
- Period key: `YYYY-MM-DD:IdTransaccion` en timezone `America/El_Salvador`
- Idempotencia: `billing_events` + `billing_subscription_period_grants` unique `(subscription_id, period_key)` + unique `(provider, external_transaction_id)`
- Checkout afiliación: `POST /api/billing/subscription` crea pending + **dedicated** `EnlacePagoRecurrente` cuando flag=true
- Cancel DELETE: **HARD BLOCK** (`individual_cancel_unsupported`)

### CANCELLATION PROVIDER LIMITATION

One-link-per-subscription es **candidato** (OpenAPI permite crear muchos enlaces y desactivar por id), pero **no demostrado seguro** sin canary real:

- riesgo multi-afiliación si se comparte URL;
- límites/costos de panel desconocidos;
- desactivar enlace es irreversible a nivel de cobros futuros del link.

Por tanto: **Manage/Cancel disabled**. No se llama `disableEnlacePagoRecurrente` como cancel de usuario.

### Gaps restantes

1. Cancel individual (limitación Wompi) / one-link-per-sub no probado en productivo
2. Renovación E2E requiere negocio activo + cargo real (sin sandbox)
3. No hay API documentada para listar transacciones por `IdSuscripcion` → reconciler no puede auto-reparar pagos perdidos sin `IdTransaccion`

### Period key / idempotencia

`period_key` = `cycle:YYYY-MM` (America/El_Salvador), anclado a `wompi_dia_pago` cuando existe.
**No** incluye `IdTransaccion` (dos txs aprobadas en el mismo ciclo colisionan en
`unique(subscription_id, period_key)` → un solo grant).

Barreras Postgres (RPC `grant_subscription_period_credits`):

1. `FOR UPDATE` sobre `billing_subscriptions`
2. `unique(subscription_id, period_key)`
3. `unique(provider, external_transaction_id)`
4. `unique(provider, external_event_key)` en `billing_events` (webhook)

Reconciliación diaria **nunca** llama al grant RPC.

### Feature flags (sin cambiar)

| Flag | Valor |
|---|---|
| `BILLING_ENABLED` | `true` (Mini Pack sandbox) |
| `BILLING_SUBSCRIPTIONS_ENABLED` | `false` |
| `WOMPI_EXPECT_PRODUCTIVE` | `false` |

### Future real canary (NO ejecutar)

1. Activar negocio productivo + `WOMPI_EXPECT_PRODUCTIVE=true`
2. `BILLING_SUBSCRIPTIONS_ENABLED=true` (solo canary)
3. Una afiliación Practice o Plus controlada
4. Verificar primer cobro → webhook `IdSuscripcion` → grant (+20/+50) una vez
5. Duplicate webhook → +0
6. Cron reconcile → snapshot OK; sin grant inventado
7. Kill switch: `BILLING_SUBSCRIPTIONS_ENABLED=false` y/o `BILLING_ENABLED=false`
8. Renovación real: esperar `diaDePago` / ciclo Wompi (sin simulación)

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
| `BILLING_ENABLED` | feature flag checkout Mini Pack |
| `BILLING_SUBSCRIPTIONS_ENABLED` | feature flag Practice/Plus (default false; grant still blocked) |
| `NEXT_PUBLIC_APP_URL` | base para redirect/webhook |

Ver `.env.example` si existe; si no, esta tabla es la fuente.

## Dónde configurar (sandbox E2E)

Proyecto Vercel: **`piano-notes-from-song`** (alias `https://piano-notes-from-song.vercel.app`).

Variables **server-only** (Production + Preview; nunca `NEXT_PUBLIC_*` excepto la URL pública):

| Variable | Target | Notas |
|---|---|---|
| `WOMPI_CLIENT_ID` | Production (+ Preview si se prueba ahí) | App ID panel |
| `WOMPI_CLIENT_SECRET` | idem | API Secret — **Secret**, no loggear |
| `WOMPI_APLICATIVO_ID` | idem | Id negocio |
| `WOMPI_EXPECT_PRODUCTIVE` | idem | `false` mientras el aplicativo esté en desarrollo |
| `BILLING_ENABLED` | idem | `true` sandbox Mini Pack |
| `BILLING_SUBSCRIPTIONS_ENABLED` | idem | dejar `false` hasta desbloqueo docs |
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

Practice/Plus: **SUBSCRIPTIONS PARTIALLY READY** — sin E2E recurrente.

Helper: `python scripts/production-canary/e2e_wompi_mini_pack.py --check-config`

## Checklist sandbox

- [x] Negocio en **modo desarrollo** en panel.wompi.sv
- [x] App ID / API Secret en Vercel
- [x] Env + `WOMPI_EXPECT_PRODUCTIVE=false`, `BILLING_ENABLED=true`
- [x] Migration `0012` aplicada
- [x] Migration `0013` (subscriptions schema) aplicada en Supabase
- [x] Webhook URL usada en EnlacePago
- [x] Mini Pack de prueba exitoso (+5 una vez)
- [x] Duplicate settle no duplica créditos
- [x] Redirect no cambia balance por sí solo
- [x] Decidir dejar `BILLING_ENABLED=true` + `WOMPI_EXPECT_PRODUCTIVE=false` (sandbox usable; sin cobro real)
- [ ] Practice/Plus E2E — **bloqueado** hasta respuestas soporte Wompi

## Páginas legales (prep go-live)

| Path | Contenido |
|---|---|
| `/terms` | Servicio, cuenta, créditos/Mini Pack, uploads, disponibilidad, limitación, abuso |
| `/privacy` | Cuenta, uploads, audio, Supabase, Modal, Wompi, logs, retención, contacto |
| `/refund` | Mini Pack; créditos usados vs no usados; errores/duplicados; soporte |

Públicas vía `AuthGate` (`PUBLIC_PATHS`). Enlaces en `/pricing`.

## Kill switch: `BILLING_ENABLED`

| Acción | Efecto |
|---|---|
| `BILLING_ENABLED=false` (+ redeploy) | Checkout nuevo → 503 `billing_disabled`. UI muestra “Payments setup in progress”. |
| Purchases ya `paid` / créditos otorgados | **No se revierten.** Usuarios siguen usando créditos. |
| Webhooks pendientes / en vuelo | El endpoint webhook **sigue activo** si hay credenciales Wompi; settle idempotente puede completar una compra ya creada. Para emergencia total: además apagar negocio productivo en panel Wompi y/o rotar secret. |
| Mini Pack sandbox | Con `BILLING_ENABLED=true` + `WOMPI_EXPECT_PRODUCTIVE=false` y negocio en **desarrollo**, sigue cobrando en modo prueba. |

Recomendación actual (prep): mantener **`BILLING_ENABLED=true`** + **`WOMPI_EXPECT_PRODUCTIVE=false`** para que sandbox Mini Pack siga usable; cobros reales siguen imposibles mientras el negocio Wompi esté en desarrollo.

## Auditoría cutover (docs.wompi.sv — sin inventar)

Fuente: [docs.wompi.sv](https://docs.wompi.sv/), Datos Aplicativo, Enlace de Pago, Transacciones de prueba, Redirect.

| Tema | Qué cambia al pasar a productivo | Qué NO cambia |
|---|---|---|
| API base | — | Misma `https://api.wompi.sv` y `https://id.wompi.sv/connect/token` |
| OAuth App ID / API Secret | Solo si el panel emite otro aplicativo; **no** hay “env sandbox” distinto en la API | Mismo App ID/Secret si se reutiliza el mismo negocio |
| Negocio / aplicativo | Toggle en **Panel Wompi** → `estaProductivo=true` (cobros reales) | EnlacePago API igual; `estaProductivo` refleja el negocio |
| Webhook | Payload con `EsProductiva=true` en cobros reales | Misma URL, mismo HMAC con API Secret |
| Redirect | `esReal=true` en cobros reales | Misma `urlRedirect` / hash |
| Nuestro código | Solo `WOMPI_EXPECT_PRODUCTIVE=true` para aceptar `EsProductiva`/`esReal` productivos y rechazar prueba | Catálogo Mini Pack $2.99 / +5 fijo |

## Checklist de cutover de un solo uso (FUTURO — NO ejecutar ahora)

**Precondiciones:** Terms/Privacy/Refund live; tests verdes; sandbox E2E ya pasado; Practice/Plus siguen off.

### A. Wompi (panel)

1. Entrar a [panel.wompi.sv](https://panel.wompi.sv).
2. Seleccionar el **mismo negocio/aplicativo** usado en sandbox (App ID actual).
3. Activar negocio a **productivo** (docs: “Para poner productivo un negocio es necesario hacerlo en el Panel de Wompi”).
4. Confirmar en panel o vía API Datos Aplicativo: `estaProductivo=true`.
5. Webhook URL sigue: `https://piano-notes-from-song.vercel.app/api/billing/wompi/webhook`.
6. **No** crear enlaces de pago a mano; Pianissimo los genera vía API.

### B. Vercel (proyecto `piano-notes-from-song`)

1. Mantener `WOMPI_CLIENT_ID` / `WOMPI_CLIENT_SECRET` (mismos salvo nuevo aplicativo).
2. `WOMPI_APLICATIVO_ID` opcional (default = App ID).
3. Set **`WOMPI_EXPECT_PRODUCTIVE=true`** (Production).
4. Mantener **`BILLING_ENABLED=true`**.
5. Mantener **`NEXT_PUBLIC_APP_URL=https://piano-notes-from-song.vercel.app`**.
6. Mantener **`BILLING_SUBSCRIPTIONS_ENABLED`** unset/false.
7. **Redeploy** Production (env no aplica a deployments viejos).

### C. Verificación post-deploy (antes del cobro)

1. `GET` health/billing status: `billing_enabled=true`.
2. Confirmar que un webhook de prueba (`EsProductiva=false`) sería `wrong_environment` si llegara.
3. No generar checkout hasta el paso D.

### D. UNA compra real controlada

1. Cuenta de prueba controlada; anotar `credits_before`.
2. `/pricing` → Buy Mini Pack → una sola purchase; anotar `purchase_id` + URL EnlacePago.
3. Confirmar en respuesta/enlace que es productivo (`estaProductivo` / panel).
4. Pagar **$2.99** manualmente una vez.
5. Validar: webhook HMAC OK → TransaccionCompra aprobada → `EsProductiva`/`esReal` true → purchase `paid` → +5 una vez → `billing_events` processed → balance en `/account`.
6. Reprocesar mismo evento: balance sin segundo +5.
7. Si falla: paso E inmediatamente.

### E. Revertir de emergencia

1. Vercel: `BILLING_ENABLED=false` → redeploy (bloquea nuevos checkouts).
2. Opcional: panel Wompi → volver negocio a **desarrollo** (deja de cobrar real).
3. Opcional: `WOMPI_EXPECT_PRODUCTIVE=false` + redeploy (rechaza eventos productivos).
4. Créditos ya otorgados: no se borran automáticamente; reconciliar a mano si hubo cobro erróneo.
5. No lanzar Practice/Plus en el mismo incidente.

## Estado prep producción (2026-09-21)

| Ítem | Estado |
|---|---|
| Código Mini Pack + settle idempotente | Listo |
| Sandbox E2E | Passed (purchase `5913c4ec…`, tx `88c8ed50…`) |
| Terms / Privacy / Refund | Listo en app |
| `WOMPI_EXPECT_PRODUCTIVE` | **`false` (no flip)** |
| Negocio Wompi productivo | **No activado** (sigue desarrollo) |
| Cobro real | **No ejecutado** |
| Practice / Plus | Off |

## Endpoints

| Método | Path | Notas |
|---|---|---|
| POST | `/api/billing/checkout` | Auth; Mini Pack EnlacePago |
| POST | `/api/billing/subscription` | Auth; Practice/Plus cuando flag on; cancel DELETE blocked |
| DELETE | `/api/billing/subscription` | Cancel individual — HARD BLOCK (Wompi support) |
| POST | `/api/billing/wompi/webhook` | Mini Pack + subscription (`IdSuscripcion`) settle |
| GET/POST | `/api/billing/reconcile-subscriptions` | Daily cron; snapshot only; no grants/charges |
| GET | `/api/billing/status` | Own catalog/usage/purchases/subs |
| UI | `/pricing`, `/billing/return`, `/account`, `/terms`, `/privacy`, `/refund` | Practice/Plus Coming soon while flag off |

## Qué sacar del panel Wompi

1. **App ID** → `WOMPI_CLIENT_ID`
2. **API Secret** → `WOMPI_CLIENT_SECRET`
3. **Id del negocio / aplicativo** → `WOMPI_APLICATIVO_ID` (opcional; default App ID)
4. Confirmación de modo desarrollo vs productivo (`estaProductivo`)
5. (Opcional más adelante) ids de `EnlacePagoRecurrente` pre-creados para Practice/Plus
