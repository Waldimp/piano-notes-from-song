-- Fix ambiguous worker_generation in acquire_next_modal_dispatch.
begin;

grant worker_control_owner to current_user with set true;
grant usage, create on schema public to worker_control_owner;

create or replace function public.acquire_next_modal_dispatch(
  p_dispatcher_id text,
  p_lease_seconds integer default 30
)
returns table(
  dispatch_id uuid,
  request_id uuid,
  attempt_no integer,
  worker_generation bigint,
  lease_owner text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_control public.worker_control%rowtype;
  v_dispatch public.dispatch_outbox%rowtype;
  v_owner text;
begin
  if p_dispatcher_id is null or p_dispatcher_id !~ '^[A-Za-z0-9._:-]{1,120}$' then
    return;
  end if;
  if p_lease_seconds is null or p_lease_seconds < 5 or p_lease_seconds > 120 then
    raise exception 'invalid dispatch lease seconds' using errcode = '22023';
  end if;

  select * into strict v_control
  from public.worker_control where singleton = true for update;

  if v_control.mode <> 'modal' or v_control.kill_switch then
    return;
  end if;

  update public.dispatch_outbox d set
    state = 'pending',
    lease_owner = null,
    lease_expires_at = null,
    updated_at = clock_timestamp(),
    last_error = 'dispatcher lease expired before spawn reservation'
  where d.state = 'leased' and d.lease_expires_at < clock_timestamp();

  if exists (
    select 1 from public.dispatch_outbox d
    where d.state in ('leased', 'spawning', 'acknowledged')
  ) then
    return;
  end if;

  select d.* into v_dispatch
  from public.dispatch_outbox d
  where d.state = 'pending'
    and d.available_at <= clock_timestamp()
    and d.worker_generation = v_control.generation
  order by d.available_at, d.created_at
  for update of d skip locked
  limit 1;

  if not found then
    return;
  end if;

  v_owner := left(p_dispatcher_id, 120);
  update public.dispatch_outbox d set
    state = 'leased',
    lease_owner = v_owner,
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    delivery_count = d.delivery_count + 1,
    updated_at = clock_timestamp()
  where d.dispatch_id = v_dispatch.dispatch_id;

  return query
  select
    v_dispatch.dispatch_id,
    v_dispatch.request_id,
    v_dispatch.attempt_no,
    v_dispatch.worker_generation,
    v_owner;
end $$;

alter function public.acquire_next_modal_dispatch(text, integer)
  owner to worker_control_owner;
revoke all on function public.acquire_next_modal_dispatch(text, integer)
  from public, anon, authenticated;
grant execute on function public.acquire_next_modal_dispatch(text, integer)
  to service_role;

revoke create on schema public from worker_control_owner;
revoke set option for worker_control_owner from current_user;

commit;
