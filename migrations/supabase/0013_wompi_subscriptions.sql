-- 0013 Wompi subscriptions prep (schema + idempotent period grants).
-- Does NOT enable production recurrent billing.
-- Credit grants for Practice/Plus remain blocked until Wompi documents
-- webhook↔subscriber correlation and individual cancel (see WOMPI_INTEGRATION.md).

-- ---------------------------------------------------------------------
-- Extend billing_subscriptions (reuse table; no new subscription concept table)
-- ---------------------------------------------------------------------
alter table public.billing_subscriptions
  add column if not exists external_subscription_id text,
  add column if not exists current_period_starts_at timestamptz,
  add column if not exists last_payment_transaction_id text,
  add column if not exists next_billing_at timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false;

comment on column public.billing_subscriptions.external_enlace_id is
  'Wompi EnlacePagoRecurrente id (shared plan link). Alias conceptual: external_link_id.';
comment on column public.billing_subscriptions.external_subscription_id is
  'Wompi individual subscription id from GET .../suscripciones (SuscripcionEnlacePagoRecurrenteOutputDto.id).';
comment on column public.billing_subscriptions.current_period_ends_at is
  'End of current paid period (internal).';

create unique index if not exists billing_subscriptions_provider_ext_sub_unique
  on public.billing_subscriptions(provider, external_subscription_id)
  where external_subscription_id is not null;

create index if not exists billing_subscriptions_link_idx
  on public.billing_subscriptions(provider, external_enlace_id)
  where external_enlace_id is not null;

-- ---------------------------------------------------------------------
-- Period grants (idempotent: one credit grant per subscription period)
-- Separates payment tx / subscription / entitlement / ledger concerns.
-- ---------------------------------------------------------------------
create table if not exists public.billing_subscription_period_grants (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'wompi',
  subscription_id uuid not null
    references public.billing_subscriptions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null references public.billing_products(product_code),
  period_key text not null,
  external_transaction_id text not null,
  credits_granted integer not null check (credits_granted > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint billing_sub_period_grants_sub_period_unique
    unique (subscription_id, period_key),
  constraint billing_sub_period_grants_provider_tx_unique
    unique (provider, external_transaction_id)
);

create index if not exists billing_sub_period_grants_user_idx
  on public.billing_subscription_period_grants(user_id, created_at desc);

alter table public.billing_subscription_period_grants enable row level security;
revoke all on public.billing_subscription_period_grants from public, anon, authenticated;
grant select on public.billing_subscription_period_grants to authenticated;

drop policy if exists billing_sub_period_grants_select_own
  on public.billing_subscription_period_grants;
create policy billing_sub_period_grants_select_own
  on public.billing_subscription_period_grants
  for select to authenticated using (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE for authenticated.

grant select, insert, update on public.billing_subscription_period_grants to service_role;

-- Extend ledger reasons for subscription period grants
alter table public.user_credit_ledger
  drop constraint if exists user_credit_ledger_reason_check;

alter table public.user_credit_ledger
  add constraint user_credit_ledger_reason_check
  check (reason in (
    'free_grant', 'plan_grant', 'admin_adjust', 'purchase_grant',
    'subscription_grant',
    'reserve', 'settle', 'release'
  ));

-- ---------------------------------------------------------------------
-- Idempotent period credit grant (callable only when correlation is proven)
-- ---------------------------------------------------------------------
create or replace function public.grant_subscription_period_credits(
  p_subscription_id uuid,
  p_period_key text,
  p_external_transaction_id text,
  p_event_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_sub public.billing_subscriptions%rowtype;
  v_product public.billing_products%rowtype;
  v_existing public.billing_subscription_period_grants%rowtype;
  v_balance integer;
  v_period_start timestamptz;
  v_period_end timestamptz;
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'service role only' using errcode = '42501';
  end if;

  if p_period_key is null or length(trim(p_period_key)) < 1 then
    return jsonb_build_object('ok', false, 'code', 'missing_period_key');
  end if;
  if p_external_transaction_id is null or length(trim(p_external_transaction_id)) < 1 then
    return jsonb_build_object('ok', false, 'code', 'missing_transaction_id');
  end if;

  select * into v_sub
  from public.billing_subscriptions
  where id = p_subscription_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'subscription_not_found');
  end if;

  select * into v_existing
  from public.billing_subscription_period_grants
  where subscription_id = p_subscription_id
    and period_key = p_period_key;

  if found then
    return jsonb_build_object(
      'ok', true,
      'code', 'already_granted',
      'subscription_id', v_sub.id,
      'period_key', p_period_key,
      'credits_granted', v_existing.credits_granted,
      'external_transaction_id', v_existing.external_transaction_id
    );
  end if;

  if exists (
    select 1 from public.billing_subscription_period_grants
    where provider = v_sub.provider
      and external_transaction_id = p_external_transaction_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'transaction_already_used');
  end if;

  select * into strict v_product
  from public.billing_products
  where product_code = v_sub.product_code;

  if v_product.billing_type <> 'subscription' then
    return jsonb_build_object('ok', false, 'code', 'not_subscription_product');
  end if;

  v_period_start := clock_timestamp();
  v_period_end := v_period_start + make_interval(days => coalesce(v_product.period_days, 30));

  insert into public.billing_subscription_period_grants(
    provider, subscription_id, user_id, product_code,
    period_key, external_transaction_id, credits_granted
  )
  values (
    v_sub.provider, v_sub.id, v_sub.user_id, v_sub.product_code,
    p_period_key, p_external_transaction_id, v_product.credits
  );

  update public.billing_subscriptions
  set status = 'active',
      current_period_starts_at = v_period_start,
      current_period_ends_at = v_period_end,
      next_billing_at = v_period_end,
      last_payment_transaction_id = p_external_transaction_id,
      updated_at = clock_timestamp()
  where id = v_sub.id;

  insert into public.account_entitlements(user_id, plan_code, credit_balance)
  values (v_sub.user_id, v_product.plan_code, v_product.credits)
  on conflict (user_id) do update
    set plan_code = excluded.plan_code,
        credit_balance = public.account_entitlements.credit_balance + excluded.credit_balance,
        updated_at = clock_timestamp()
  returning credit_balance into v_balance;

  insert into public.user_credit_ledger(user_id, request_id, delta, reason, status, metadata)
  values (
    v_sub.user_id,
    null,
    v_product.credits,
    'subscription_grant',
    'posted',
    jsonb_build_object(
      'subscription_id', v_sub.id,
      'product_code', v_sub.product_code,
      'period_key', p_period_key,
      'external_transaction_id', p_external_transaction_id,
      'provider', v_sub.provider,
      'event_id', p_event_id
    )
  );

  if p_event_id is not null then
    update public.billing_events
    set processing_status = 'processed'
    where id = p_event_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'granted',
    'subscription_id', v_sub.id,
    'period_key', p_period_key,
    'credits_granted', v_product.credits,
    'credit_balance', v_balance,
    'plan_code', v_product.plan_code
  );
exception
  when unique_violation then
    -- Concurrent duplicate period or tx → treat as already granted / conflict
    select * into v_existing
    from public.billing_subscription_period_grants
    where subscription_id = p_subscription_id
      and period_key = p_period_key;
    if found then
      return jsonb_build_object(
        'ok', true,
        'code', 'already_granted',
        'subscription_id', p_subscription_id,
        'period_key', p_period_key,
        'credits_granted', v_existing.credits_granted
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'grant_conflict');
end $$;

revoke all on function public.grant_subscription_period_credits(uuid, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.grant_subscription_period_credits(uuid, text, text, bigint)
  to service_role;

-- Keep products checkout_enabled false for practice/plus until lifecycle unblocked
update public.billing_products
set description = case product_code
  when 'practice' then
    'Monthly subscription: 20 credits/period — SUBSCRIPTIONS PARTIALLY READY (correlation/cancel pending Wompi docs)'
  when 'plus' then
    'Monthly subscription: 50 credits/period — SUBSCRIPTIONS PARTIALLY READY (correlation/cancel pending Wompi docs)'
  else description
end,
updated_at = clock_timestamp()
where product_code in ('practice', 'plus');
