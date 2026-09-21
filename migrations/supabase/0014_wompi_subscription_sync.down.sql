-- DOWN 0014
drop table if exists public.billing_subscription_sync_events;

drop index if exists billing_subscriptions_provider_subscriber_link_unique;
drop index if exists billing_subscriptions_subscriber_idx;

alter table public.billing_subscriptions
  drop column if exists external_subscriber_id,
  drop column if exists wompi_alias,
  drop column if exists wompi_nombre_suscriptor,
  drop column if exists wompi_monto,
  drop column if exists pagos_realizados,
  drop column if exists wompi_estado_raw,
  drop column if exists wompi_fecha_inicio,
  drop column if exists wompi_dia_pago,
  drop column if exists last_synced_at,
  drop column if exists last_pagos_realizados_observed,
  drop column if exists pending_unverified_payment_count;
