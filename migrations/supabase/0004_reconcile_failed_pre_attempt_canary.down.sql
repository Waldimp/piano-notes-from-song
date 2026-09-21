-- Roll back only an unused failed-before-attempt reconciliation adjunct.
begin;

grant worker_control_owner to current_user with set true;

do $$
begin
  if exists (select 1 from public.failed_pre_attempt_reconciliations) then
    raise exception 'rollback refused: failed-before-attempt reconciliation history exists';
  end if;
end $$;

drop function if exists public.reconcile_failed_before_attempt(uuid,uuid,text,text,text);
drop policy if exists requests_control_owner_update on public.requests;
drop policy if exists requests_control_owner_select on public.requests;
drop policy if exists failed_pre_attempt_reconciliations_owner_all
  on public.failed_pre_attempt_reconciliations;
drop table if exists public.failed_pre_attempt_reconciliations;

revoke set option for worker_control_owner from current_user;

commit;
