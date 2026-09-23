-- Down 0015: best-effort revert of additive columns (status constraint left expanded).

alter table public.billing_subscriptions
  drop column if exists dedicated_enlace,
  drop column if exists reconciliation_status,
  drop column if exists last_reconciled_at;

drop index if exists billing_subscriptions_reconcile_idx;
drop index if exists billing_subscriptions_enlace_idx;
