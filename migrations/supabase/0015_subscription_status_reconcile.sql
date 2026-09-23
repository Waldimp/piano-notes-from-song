-- 0015 Subscription status + dedicated-link + reconciliation fields.
-- Incorporates Wompi support EstadoSuscripcion 0–4. Does NOT enable
-- BILLING_SUBSCRIPTIONS_ENABLED or productive charges.

-- Expand allowed local statuses (keep past_due/expired for back-compat)
alter table public.billing_subscriptions
  drop constraint if exists billing_subscriptions_status_check;

alter table public.billing_subscriptions
  add constraint billing_subscriptions_status_check
  check (status in (
    'pending', 'active', 'past_due', 'cancelled', 'expired',
    'suspended', 'finished', 'undefined'
  ));

alter table public.billing_subscriptions
  add column if not exists dedicated_enlace boolean not null default false,
  add column if not exists reconciliation_status text,
  add column if not exists last_reconciled_at timestamptz;

comment on column public.billing_subscriptions.dedicated_enlace is
  'True when EnlacePagoRecurrente was created for this subscription only (cancel strategy candidate; not proven safe yet).';
comment on column public.billing_subscriptions.reconciliation_status is
  'ok | requires_review | null — set by daily reconciler; never auto-grants without verified tx';
comment on column public.billing_subscriptions.wompi_estado_raw is
  'Wompi EstadoSuscripcion: 0 Activa, 1 Suspendida, 2 Cancelada, 3 Finalizada, 4 NoDefinido (support 2026-09)';

-- Ensure unique index on external_subscription_id exists (from 0013)
create unique index if not exists billing_subscriptions_provider_ext_sub_unique
  on public.billing_subscriptions(provider, external_subscription_id)
  where external_subscription_id is not null;

create index if not exists billing_subscriptions_enlace_idx
  on public.billing_subscriptions(provider, external_enlace_id)
  where external_enlace_id is not null;

create index if not exists billing_subscriptions_reconcile_idx
  on public.billing_subscriptions(status, last_reconciled_at)
  where status in ('pending', 'active', 'suspended', 'past_due');

update public.billing_products
set description = case product_code
  when 'practice' then
    'Monthly subscription: 20 credits/period — webhook IdSuscripcion + period grants ready; cancel limited; flag off'
  when 'plus' then
    'Monthly subscription: 50 credits/period — webhook IdSuscripcion + period grants ready; cancel limited; flag off'
  else description
end,
updated_at = clock_timestamp()
where product_code in ('practice', 'plus');
