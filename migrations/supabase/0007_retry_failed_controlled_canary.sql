-- Recover an unambiguous deterministic canary failure without creating a new
-- request. This is intentionally unavailable unless the control plane is
-- paused with its kill switch engaged.
begin;

create policy songs_control_owner_select on public.songs
  for select to worker_control_owner using (true);
create policy songs_control_owner_insert on public.songs
  for insert to worker_control_owner with check (true);

grant worker_control_owner to current_user with set true;
grant usage, create on schema public to worker_control_owner;
set local role worker_control_owner;

create or replace function public.requeue_failed_controlled_attempt(
  p_request_id uuid, p_attempt_id uuid, p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_control public.worker_control%rowtype;
  v_request public.requests%rowtype;
  v_attempt public.request_attempts%rowtype;
  v_dispatch public.dispatch_outbox%rowtype;
begin
  if p_request_id is null or p_attempt_id is null
     or p_reason is null or length(trim(p_reason)) = 0 then
    return false;
  end if;
  select * into strict v_control from public.worker_control where singleton = true for update;
  if v_control.mode <> 'paused' or not v_control.kill_switch then return false; end if;
  select * into strict v_request from public.requests where id = p_request_id for update;
  select * into strict v_attempt from public.request_attempts
    where id = p_attempt_id and request_id = p_request_id for update;
  select * into strict v_dispatch from public.dispatch_outbox
    where dispatch_id = v_attempt.dispatch_id and request_id = p_request_id for update;
  if v_request.status <> 'error' or v_request.attempt_count <> v_attempt.attempt_no
     or v_request.attempt_count >= v_request.max_attempts
     or v_attempt.status <> 'failed' or v_dispatch.state <> 'closed' then
    return false;
  end if;
  if exists (
    select 1 from public.request_artifacts
    where request_id = p_request_id and state <> 'cleaned'
  ) then return false; end if;
  update public.request_attempts set status = 'retry_scheduled',
    error = left(p_reason, 500), finished_at = clock_timestamp()
  where id = p_attempt_id;
  update public.requests set status = 'queued', worker_kind = null,
    lease_token = null, lease_expires_at = null, heartbeat_at = null,
    next_attempt_at = clock_timestamp(), error = null, failure_code = null,
    finished_at = null
  where id = p_request_id;
  insert into public.dispatch_outbox(request_id, attempt_no, worker_generation)
  values (p_request_id, v_attempt.attempt_no + 1, v_control.generation);
  return true;
end $$;

alter function public.requeue_failed_controlled_attempt(uuid, uuid, text)
  owner to worker_control_owner;
revoke all on function public.requeue_failed_controlled_attempt(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.requeue_failed_controlled_attempt(uuid, uuid, text)
  to worker_control_admin;

reset role;
revoke create on schema public from worker_control_owner;
revoke set option for worker_control_owner from current_user;
commit;
