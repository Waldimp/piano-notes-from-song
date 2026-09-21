-- Down: 0012_wompi_billing

drop function if exists public.settle_billing_purchase(uuid, text, bigint);

drop policy if exists billing_subscriptions_select_own on public.billing_subscriptions;
drop policy if exists billing_purchases_select_own on public.billing_purchases;
drop policy if exists billing_products_read on public.billing_products;

drop table if exists public.billing_events;
drop table if exists public.billing_subscriptions;
drop table if exists public.billing_purchases;
drop table if exists public.billing_products;

alter table public.user_credit_ledger
  drop constraint if exists user_credit_ledger_reason_check;

alter table public.user_credit_ledger
  add constraint user_credit_ledger_reason_check
  check (reason in (
    'free_grant', 'plan_grant', 'admin_adjust',
    'reserve', 'settle', 'release'
  ));
