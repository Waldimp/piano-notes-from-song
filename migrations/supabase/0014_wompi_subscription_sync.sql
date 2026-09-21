-- 0014 Persist Wompi subscription snapshot fields for safe reconciliation.
-- Does NOT enable credit grants or BILLING_SUBSCRIPTIONS_ENABLED.
-- Source: OpenAPI SuscripcionEnlacePagoRecurrenteOutputDto + Términos Usuario Wompi.

alter table public.billing_subscriptions
  add column if not exists external_subscriber_id text,
  add column if not exists wompi_alias text,
  add column if not exists wompi_nombre_suscriptor text,
  add column if not exists wompi_monto numeric(10,2),
  add column if not exists pagos_realizados integer,
  add column if not exists wompi_estado_raw integer,
  add column if not exists wompi_fecha_inicio timestamptz,
  add column if not exists wompi_dia_pago integer
    check (wompi_dia_pago is null or (wompi_dia_pago >= 1 and wompi_dia_pago <= 31)),
  add column if not exists last_synced_at timestamptz,
  add column if not exists last_pagos_realizados_observed integer,
  add column if not exists pending_unverified_payment_count integer;

comment on column public.billing_subscriptions.external_subscriber_id is
  'Wompi idSuscriptor from GET /EnlacePagoRecurrente/{id}/suscripciones';
comment on column public.billing_subscriptions.pagos_realizados is
  'Last synced Wompi pagosRealizados (count only; not a verified tx id)';
comment on column public.billing_subscriptions.wompi_estado_raw is
  'Raw EstadoSuscripcion enum 0–4; labels not published in OpenAPI';
comment on column public.billing_subscriptions.pending_unverified_payment_count is
  'Increments of pagosRealizados awaiting verified approved transaction before grant';

create unique index if not exists billing_subscriptions_provider_subscriber_link_unique
  on public.billing_subscriptions(provider, external_enlace_id, external_subscriber_id)
  where external_subscriber_id is not null and external_enlace_id is not null;

create index if not exists billing_subscriptions_subscriber_idx
  on public.billing_subscriptions(provider, external_subscriber_id)
  where external_subscriber_id is not null;

-- Observation log: idempotent record of pagosRealizados changes WITHOUT credit grant.
create table if not exists public.billing_subscription_sync_events (
  id bigserial primary key,
  provider text not null default 'wompi',
  subscription_id uuid references public.billing_subscriptions(id) on delete set null,
  external_subscription_id text,
  external_subscriber_id text,
  observation_key text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  credit_grant_allowed boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  constraint billing_sub_sync_events_observation_unique
    unique (provider, observation_key)
);

create index if not exists billing_sub_sync_events_sub_idx
  on public.billing_subscription_sync_events(subscription_id, created_at desc);

alter table public.billing_subscription_sync_events enable row level security;
revoke all on public.billing_subscription_sync_events from public, anon, authenticated;
-- No authenticated access — service_role / ops only.
grant select, insert on public.billing_subscription_sync_events to service_role;
grant usage, select on sequence public.billing_subscription_sync_events_id_seq to service_role;
