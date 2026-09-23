-- 0016 Document monthly period_key contract + strengthen grant race handling.
-- Safe additive: COMMENT + CREATE OR REPLACE function only.
-- Does NOT enable BILLING_SUBSCRIPTIONS_ENABLED or productive charges.
--
-- period_key identity (app): cycle:YYYY-MM in America/El_Salvador, anchored by
-- wompi_dia_pago when known. MUST NOT embed IdTransaccion (two txs in one cycle
-- must collide on unique(subscription_id, period_key)).
-- Duplicate transactions remain blocked by unique(provider, external_transaction_id).

comment on column public.billing_subscription_period_grants.period_key is
  'Billing-cycle id (e.g. cycle:2026-09). Unique per subscription. Not transaction-scoped. Tx dedupe via unique(provider, external_transaction_id).';

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

  -- Row lock: webhook vs any concurrent settler serialize on this subscription.
  select * into v_sub
  from public.billing_subscriptions
  where id = p_subscription_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'subscription_not_found');
  end if;

  -- Barrier 1: same billing cycle already granted
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

  -- Barrier 2: same provider transaction already used (any period)
  select * into v_existing
  from public.billing_subscription_period_grants
  where provider = v_sub.provider
    and external_transaction_id = p_external_transaction_id;

  if found then
    return jsonb_build_object(
      'ok', true,
      'code', 'already_granted',
      'subscription_id', v_existing.subscription_id,
      'period_key', v_existing.period_key,
      'credits_granted', v_existing.credits_granted,
      'external_transaction_id', p_external_transaction_id,
      'detail', 'transaction_already_used'
    );
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
    -- Concurrent webhook/settler: prefer period match, else tx match
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
        'credits_granted', v_existing.credits_granted,
        'external_transaction_id', v_existing.external_transaction_id
      );
    end if;
    select * into v_existing
    from public.billing_subscription_period_grants
    where provider = 'wompi'
      and external_transaction_id = p_external_transaction_id;
    if found then
      return jsonb_build_object(
        'ok', true,
        'code', 'already_granted',
        'subscription_id', v_existing.subscription_id,
        'period_key', v_existing.period_key,
        'credits_granted', v_existing.credits_granted,
        'detail', 'transaction_already_used'
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'grant_conflict');
end $$;

revoke all on function public.grant_subscription_period_credits(uuid, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.grant_subscription_period_credits(uuid, text, text, bigint)
  to service_role;
