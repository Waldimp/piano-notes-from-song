-- Production-canary authorization adjunct. Prepared locally; do not apply yet.
-- Exactly one row may be armed. Reservation and consumption are one transaction.
begin;

-- PostgreSQL requires membership in a target owner role for ALTER OWNER.
-- The membership is revoked before commit.
grant worker_control_owner to current_user;

create table if not exists public.production_canary_arm (
  singleton boolean primary key default true check (singleton),
  request_id uuid,
  armed_at timestamptz,
  armed_by text,
  consumed_at timestamptz
);

insert into public.production_canary_arm(singleton)
values (true)
on conflict (singleton) do nothing;

create or replace function public.arm_production_canary_uuid(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_arm public.production_canary_arm%rowtype;
begin
  if p_request_id is null then
    raise exception 'canary request UUID is required' using errcode = '22023';
  end if;
  select * into v_arm from public.production_canary_arm
    where singleton = true for update;
  if v_arm.request_id is not null and v_arm.consumed_at is null then
    raise exception 'a production-canary UUID is already armed' using errcode = '55000';
  end if;
  update public.production_canary_arm set
    request_id = p_request_id, armed_at = clock_timestamp(),
    armed_by = session_user, consumed_at = null
  where singleton = true;
  return true;
end $$;

create or replace function public.reserve_production_canary_spawn(
  p_dispatch_id uuid, p_request_id uuid, p_attempt_no integer,
  p_worker_generation bigint, p_lease_owner text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_arm public.production_canary_arm%rowtype;
  v_dispatch_state text;
  v_decision text;
begin
  -- Lock the singleton before inspecting or consuming the one authorization.
  select * into v_arm from public.production_canary_arm
    where singleton = true for update;
  select state into v_dispatch_state from public.dispatch_outbox
    where dispatch_id = p_dispatch_id and request_id = p_request_id for update;
  if not found then
    return 'unauthorized';
  end if;

  -- A consumed arm can only be replayed by the exact acknowledged dispatch.
  if v_arm.request_id is null or v_arm.request_id is distinct from p_request_id then
    return 'unauthorized';
  end if;
  if v_arm.consumed_at is not null then
    if v_dispatch_state = 'acknowledged' then
      return public.reserve_dispatch_spawn(
        p_dispatch_id, p_request_id, p_attempt_no,
        p_worker_generation, p_lease_owner
      );
    end if;
    return 'unauthorized';
  end if;

  -- The existing durable dispatcher reservation runs in this transaction.
  v_decision := public.reserve_dispatch_spawn(
    p_dispatch_id, p_request_id, p_attempt_no,
    p_worker_generation, p_lease_owner
  );
  if v_decision = 'spawn' then
    update public.production_canary_arm
    set consumed_at = clock_timestamp() where singleton = true;
  end if;
  return v_decision;
end $$;

alter table public.production_canary_arm enable row level security;
drop policy if exists production_canary_arm_owner_select on public.production_canary_arm;
drop policy if exists production_canary_arm_owner_update on public.production_canary_arm;
create policy production_canary_arm_owner_select on public.production_canary_arm
  for select to worker_control_owner using (singleton);
create policy production_canary_arm_owner_update on public.production_canary_arm
  for update to worker_control_owner using (singleton) with check (singleton);

-- The SECURITY DEFINER owner receives only the table privileges needed by the
-- two functions. The service role can invoke reservation but cannot arm/read
-- the singleton directly.
alter role worker_control_owner nosuperuser nologin;
revoke all on public.production_canary_arm from public, anon, authenticated, service_role;
grant select, update on public.production_canary_arm to worker_control_owner;

alter function public.arm_production_canary_uuid(uuid)
  owner to worker_control_owner;
alter function public.reserve_production_canary_spawn(uuid,uuid,integer,bigint,text)
  owner to worker_control_owner;

revoke all on function public.arm_production_canary_uuid(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.reserve_production_canary_spawn(uuid,uuid,integer,bigint,text)
  from public, anon, authenticated;
grant execute on function public.arm_production_canary_uuid(uuid)
  to worker_control_admin;
grant execute on function public.reserve_production_canary_spawn(uuid,uuid,integer,bigint,text)
  to service_role;

revoke worker_control_owner from current_user;

commit;
