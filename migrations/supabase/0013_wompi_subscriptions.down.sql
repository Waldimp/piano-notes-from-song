-- DOWN 0013
drop function if exists public.grant_subscription_period_credits(uuid, text, text, bigint);

drop policy if exists billing_sub_period_grants_select_own
  on public.billing_subscription_period_grants;
drop table if exists public.billing_subscription_period_grants;

drop index if exists billing_subscriptions_provider_ext_sub_unique;
drop index if exists billing_subscriptions_link_idx;

alter table public.billing_subscriptions
  drop column if exists external_subscription_id,
  drop column if exists current_period_starts_at,
  drop column if exists last_payment_transaction_id,
  drop column if exists next_billing_at,
  drop column if exists cancel_at_period_end;

-- Restore ledger reason check without subscription_grant (0012 set)
alter table public.user_credit_ledger
  drop constraint if exists user_credit_ledger_reason_check;

alter table public.user_credit_ledger
  add constraint user_credit_ledger_reason_check
  check (reason in (
    'free_grant', 'plan_grant', 'admin_adjust', 'purchase_grant',
    'reserve', 'settle', 'release'
  ));
