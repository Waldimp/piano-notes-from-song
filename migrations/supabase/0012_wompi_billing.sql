-- 0012 Wompi billing preparation (provider-agnostic tables + Mini Pack grants).
-- Does not modify 0011 body. Reuses account_entitlements + user_credit_ledger.

-- ---------------------------------------------------------------------
-- Extend user_credit_ledger reasons for paid grants
-- ---------------------------------------------------------------------
alter table public.user_credit_ledger
  drop constraint if exists user_credit_ledger_reason_check;

alter table public.user_credit_ledger
  add constraint user_credit_ledger_reason_check
  check (reason in (
    'free_grant', 'plan_grant', 'admin_adjust', 'purchase_grant',
    'reserve', 'settle', 'release'
  ));

-- ---------------------------------------------------------------------
-- Product catalog (server source of truth for price/credits)
-- ---------------------------------------------------------------------
create table if not exists public.billing_products (
  product_code text primary key
    check (product_code in ('mini_pack', 'practice', 'plus')),
  display_name text not null,
  billing_type text not null
    check (billing_type in ('one_time', 'subscription')),
  price_usd numeric(10,2) not null check (price_usd > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  credits integer not null check (credits > 0),
  plan_code text not null references public.plan_limits(plan_code),
  period_days integer
    check (period_days is null or period_days > 0),
  checkout_enabled boolean not null default false,
  description text not null default '',
  updated_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp()
);

insert into public.billing_products(
  product_code, display_name, billing_type, price_usd, credits, plan_code,
  period_days, checkout_enabled, description
)
values
  ('mini_pack', 'Mini Pack', 'one_time', 2.99, 5, 'mini', null, true,
   'One-time pack: +5 credits'),
  ('practice', 'Practice', 'subscription', 5.99, 20, 'practice', 30, false,
   'Monthly subscription: 20 credits/period — recurrent lifecycle pending official confirmation'),
  ('plus', 'Plus', 'subscription', 8.99, 50, 'plus', 30, false,
   'Monthly subscription: 50 credits/period — recurrent lifecycle pending official confirmation')
on conflict (product_code) do nothing;

-- ---------------------------------------------------------------------
-- Purchases (one-time + checkout attempts for subscriptions when enabled)
-- ---------------------------------------------------------------------
create table if not exists public.billing_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null references public.billing_products(product_code),
  amount_usd numeric(10,2) not null check (amount_usd > 0),
  currency text not null default 'USD',
  credits integer not null check (credits > 0),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'refunded', 'cancelled')),
  provider text not null default 'wompi',
  commerce_link_id text not null,
  external_enlace_id text,
  external_transaction_id text,
  url_enlace text,
  esta_productivo boolean,
  settled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint billing_purchases_commerce_link_unique unique (commerce_link_id)
);

create unique index if not exists billing_purchases_provider_tx_unique
  on public.billing_purchases(provider, external_transaction_id)
  where external_transaction_id is not null;

create index if not exists billing_purchases_user_created_idx
  on public.billing_purchases(user_id, created_at desc);

create index if not exists billing_purchases_status_idx
  on public.billing_purchases(status);

-- ---------------------------------------------------------------------
-- Provider webhook / notification events (idempotent)
-- ---------------------------------------------------------------------
create table if not exists public.billing_events (
  id bigserial primary key,
  provider text not null default 'wompi',
  external_event_key text not null,
  external_transaction_id text,
  event_type text not null default 'webhook',
  payload jsonb not null default '{}'::jsonb,
  signature_valid boolean not null default false,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processed', 'rejected', 'ignored')),
  rejection_reason text,
  purchase_id uuid references public.billing_purchases(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  constraint billing_events_provider_key_unique unique (provider, external_event_key)
);

create index if not exists billing_events_tx_idx
  on public.billing_events(provider, external_transaction_id);

-- ---------------------------------------------------------------------
-- Subscriptions (prepared; renewal/cancel lifecycle not fully confirmed)
-- ---------------------------------------------------------------------
create table if not exists public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null references public.billing_products(product_code),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'past_due', 'cancelled', 'expired')),
  provider text not null default 'wompi',
  external_enlace_id text,
  commerce_link_id text,
  current_period_ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create unique index if not exists billing_subscriptions_user_product_active
  on public.billing_subscriptions(user_id, product_code)
  where status in ('pending', 'active', 'past_due');

create index if not exists billing_subscriptions_user_idx
  on public.billing_subscriptions(user_id);

-- ---------------------------------------------------------------------
-- RLS: users read own commercial state; never write payment fields
-- ---------------------------------------------------------------------
alter table public.billing_products enable row level security;
alter table public.billing_purchases enable row level security;
alter table public.billing_events enable row level security;
alter table public.billing_subscriptions enable row level security;

revoke all on public.billing_products from public, anon, authenticated;
revoke all on public.billing_purchases from public, anon, authenticated;
revoke all on public.billing_events from public, anon, authenticated;
revoke all on public.billing_subscriptions from public, anon, authenticated;

grant select on public.billing_products to authenticated;
grant select on public.billing_purchases to authenticated;
grant select on public.billing_subscriptions to authenticated;
-- billing_events: no direct client access (server/service_role only)

drop policy if exists billing_products_read on public.billing_products;
create policy billing_products_read on public.billing_products
  for select to authenticated using (true);

drop policy if exists billing_purchases_select_own on public.billing_purchases;
create policy billing_purchases_select_own on public.billing_purchases
  for select to authenticated using (user_id = auth.uid());

drop policy if exists billing_subscriptions_select_own on public.billing_subscriptions;
create policy billing_subscriptions_select_own on public.billing_subscriptions
  for select to authenticated using (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies for authenticated on billing tables.

-- ---------------------------------------------------------------------
-- Idempotent credit grant from a paid purchase (service_role / postgres)
-- ---------------------------------------------------------------------
create or replace function public.settle_billing_purchase(
  p_purchase_id uuid,
  p_external_transaction_id text,
  p_event_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_purchase public.billing_purchases%rowtype;
  v_product public.billing_products%rowtype;
  v_balance integer;
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'service role only' using errcode = '42501';
  end if;

  select * into v_purchase
  from public.billing_purchases
  where id = p_purchase_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'purchase_not_found');
  end if;

  if v_purchase.status = 'paid' and v_purchase.settled_at is not null then
    return jsonb_build_object(
      'ok', true,
      'code', 'already_settled',
      'purchase_id', v_purchase.id,
      'credits', v_purchase.credits
    );
  end if;

  if v_purchase.status not in ('pending', 'paid') then
    return jsonb_build_object('ok', false, 'code', 'invalid_status', 'status', v_purchase.status);
  end if;

  if p_external_transaction_id is null or length(trim(p_external_transaction_id)) < 1 then
    return jsonb_build_object('ok', false, 'code', 'missing_transaction_id');
  end if;

  if v_purchase.external_transaction_id is not null
     and v_purchase.external_transaction_id is distinct from p_external_transaction_id then
    return jsonb_build_object('ok', false, 'code', 'transaction_mismatch');
  end if;

  -- Another purchase already claimed this transaction?
  if exists (
    select 1 from public.billing_purchases
    where provider = v_purchase.provider
      and external_transaction_id = p_external_transaction_id
      and id is distinct from v_purchase.id
  ) then
    return jsonb_build_object('ok', false, 'code', 'transaction_already_used');
  end if;

  select * into strict v_product
  from public.billing_products
  where product_code = v_purchase.product_code;

  update public.billing_purchases
  set status = 'paid',
      external_transaction_id = p_external_transaction_id,
      settled_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = v_purchase.id
  returning * into v_purchase;

  insert into public.account_entitlements(user_id, plan_code, credit_balance)
  values (v_purchase.user_id, v_product.plan_code, v_purchase.credits)
  on conflict (user_id) do update
    set plan_code = case
          when public.account_entitlements.plan_code = 'free' then excluded.plan_code
          when excluded.plan_code in ('practice', 'plus') then excluded.plan_code
          when public.account_entitlements.plan_code in ('practice', 'plus')
            and excluded.plan_code = 'mini' then public.account_entitlements.plan_code
          else excluded.plan_code
        end,
        credit_balance = public.account_entitlements.credit_balance + excluded.credit_balance,
        updated_at = clock_timestamp()
  returning credit_balance into v_balance;

  insert into public.user_credit_ledger(user_id, request_id, delta, reason, status, metadata)
  values (
    v_purchase.user_id,
    null,
    v_purchase.credits,
    'purchase_grant',
    'posted',
    jsonb_build_object(
      'purchase_id', v_purchase.id,
      'product_code', v_purchase.product_code,
      'external_transaction_id', p_external_transaction_id,
      'provider', v_purchase.provider,
      'event_id', p_event_id
    )
  );

  if p_event_id is not null then
    update public.billing_events
    set processing_status = 'processed',
        purchase_id = v_purchase.id
    where id = p_event_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'settled',
    'purchase_id', v_purchase.id,
    'credits_granted', v_purchase.credits,
    'credit_balance', v_balance,
    'plan_code', v_product.plan_code
  );
end $$;

revoke all on function public.settle_billing_purchase(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.settle_billing_purchase(uuid, text, bigint) to service_role;

grant select, insert, update on public.billing_purchases to service_role;
grant select, insert, update on public.billing_events to service_role;
grant usage, select on sequence public.billing_events_id_seq to service_role;
grant select, insert, update on public.billing_subscriptions to service_role;
grant select on public.billing_products to service_role;
grant select, insert, update on public.account_entitlements to service_role;
grant select, insert on public.user_credit_ledger to service_role;
grant usage, select on sequence public.user_credit_ledger_id_seq to service_role;
