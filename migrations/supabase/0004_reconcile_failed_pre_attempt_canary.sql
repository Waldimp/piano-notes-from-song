-- Recover one acknowledged production-canary receipt only after a verified
-- terminal Modal failure before any worker attempt existed.
begin;

grant worker_control_owner to current_user with set true;
grant usage, create on schema public to worker_control_owner;

create table public.failed_pre_attempt_reconciliations (
  dispatch_id uuid not null references public.dispatch_outbox(dispatch_id) on delete cascade,
  request_id uuid not null references public.requests(id) on delete cascade,
  modal_call_id text not null,
  observation_id text not null,
  terminal_state text not null check (terminal_state in ('failed', 'cancelled')),
  observed_at timestamptz not null default clock_timestamp(),
  primary key (dispatch_id, observation_id)
);

alter table public.failed_pre_attempt_reconciliations enable row level security;
create policy failed_pre_attempt_reconciliations_owner_all
  on public.failed_pre_attempt_reconciliations
  for all to worker_control_owner using (true) with check (true);
revoke all on public.failed_pre_attempt_reconciliations
  from public, anon, authenticated, service_role;
grant select, insert, update on public.failed_pre_attempt_reconciliations to worker_control_owner;

-- Existing controlled RPCs also need RLS visibility of their server-owned
-- request state; client roles retain their existing narrow policies.
create policy requests_control_owner_select on public.requests
  for select to worker_control_owner using (true);
create policy requests_control_owner_update on public.requests
  for update to worker_control_owner using (true) with check (true);

create or replace function public.reconcile_failed_before_attempt(
  p_dispatch_id uuid,
  p_request_id uuid,
  p_modal_call_id text,
  p_observation_id text,
  p_terminal_state text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_dispatch public.dispatch_outbox%rowtype;
  v_control public.worker_control%rowtype;
  v_existing public.failed_pre_attempt_reconciliations%rowtype;
begin
  if p_dispatch_id is null or p_request_id is null
     or p_modal_call_id is null or length(trim(p_modal_call_id)) = 0
     or p_observation_id is null or length(trim(p_observation_id)) = 0
     or p_terminal_state not in ('failed', 'cancelled') then
    return false;
  end if;

  select * into strict v_control from public.worker_control
    where singleton = true for update;
  if v_control.mode <> 'paused' or not v_control.kill_switch then
    return false;
  end if;

  select * into strict v_dispatch from public.dispatch_outbox d
    where d.dispatch_id = p_dispatch_id for update;
  select * into v_existing from public.failed_pre_attempt_reconciliations r
    where r.dispatch_id = p_dispatch_id
      and r.observation_id = left(p_observation_id, 200) for update;
  if found then
    return v_existing.request_id = p_request_id
      and v_existing.modal_call_id = p_modal_call_id
      and v_existing.observation_id = p_observation_id
      and v_existing.terminal_state = p_terminal_state
      and v_dispatch.state = 'pending'
      and v_dispatch.modal_call_id is null;
  end if;

  if v_dispatch.request_id is distinct from p_request_id
     or v_dispatch.state <> 'acknowledged'
     or v_dispatch.modal_call_id is distinct from p_modal_call_id then
    return false;
  end if;
  if not exists (
    select 1 from public.requests q
    where q.id = p_request_id and q.status = 'queued'
  ) then
    return false;
  end if;
  if exists (
    select 1 from public.request_attempts a
    where a.dispatch_id = p_dispatch_id
  ) or exists (
    select 1 from public.request_artifacts a
    where a.request_id = p_request_id
  ) then
    return false;
  end if;
  if exists (
    select 1 from public.worker_cost_ledger reservation
    where reservation.request_id = p_request_id
      and reservation.kind = 'reservation'
      and not exists (
        select 1 from public.worker_cost_ledger released
        where released.kind = 'release'
          and released.metadata->>'reservation_id' = reservation.id::text
      )
  ) then
    return false;
  end if;

  insert into public.failed_pre_attempt_reconciliations(
    dispatch_id, request_id, modal_call_id, observation_id, terminal_state
  ) values (
    p_dispatch_id, p_request_id, p_modal_call_id,
    left(p_observation_id, 200), p_terminal_state
  );
  update public.dispatch_outbox d set
    state = 'pending', lease_owner = null, lease_expires_at = null,
    modal_call_id = null, acknowledged_at = null,
    cost_reservation_id = null, available_at = clock_timestamp(),
    reconciled_at = clock_timestamp(), reconciliation_count = d.reconciliation_count + 1,
    last_error = 'failed before attempt: checkpoint missing', updated_at = clock_timestamp()
  where d.dispatch_id = p_dispatch_id and d.request_id = p_request_id;
  return found;
end $$;

alter function public.reconcile_failed_before_attempt(uuid,uuid,text,text,text)
  owner to worker_control_owner;
revoke all on function public.reconcile_failed_before_attempt(uuid,uuid,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_failed_before_attempt(uuid,uuid,text,text,text)
  to worker_control_admin;

revoke create on schema public from worker_control_owner;
revoke set option for worker_control_owner from current_user;

commit;
