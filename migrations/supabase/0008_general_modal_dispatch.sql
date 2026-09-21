-- 0008: general Modal dispatch control-plane helpers.
-- Extends the existing outbox without enabling automatic retries.
-- Does not relax kill_switch / mode guards.
begin;

grant worker_control_owner to current_user with set true;
grant usage, create on schema public to worker_control_owner;

-- Control-plane helper: lease the next eligible outbox row for Modal.
-- Generation is read inside the same transaction; callers never choose a UUID.
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

  update public.dispatch_outbox set
    state = 'pending',
    lease_owner = null,
    lease_expires_at = null,
    updated_at = clock_timestamp(),
    last_error = 'dispatcher lease expired before spawn reservation'
  where state = 'leased' and lease_expires_at < clock_timestamp();

  if exists (
    select 1 from public.dispatch_outbox
    where state in ('leased', 'spawning', 'acknowledged')
  ) then
    return;
  end if;

  select * into v_dispatch
  from public.dispatch_outbox
  where state = 'pending'
    and available_at <= clock_timestamp()
    and worker_generation = v_control.generation
  order by available_at, created_at
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  v_owner := left(p_dispatcher_id, 120);
  update public.dispatch_outbox set
    state = 'leased',
    lease_owner = v_owner,
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    delivery_count = delivery_count + 1,
    updated_at = clock_timestamp()
  where dispatch_id = v_dispatch.dispatch_id;

  return query
  select
    v_dispatch.dispatch_id,
    v_dispatch.request_id,
    v_dispatch.attempt_no,
    v_dispatch.worker_generation,
    v_owner;
end $$;

-- Allow a later attempt of the SAME request to reuse a cleaned canonical path.
-- Does not permit cross-request ownership transfer and does not enable retries
-- by itself; controlled_runner still reports p_retryable=false.
create or replace function public.record_request_artifact(
  p_request_id uuid, p_attempt_id uuid, p_lease_token uuid,
  p_bucket text, p_object_path text, p_kind text,
  p_sha256 text, p_size_bytes bigint, p_state text
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_id bigint;
  v_target_song_id text;
begin
  if p_state not in ('staged', 'committed', 'cleaned') then
    raise exception 'invalid artifact state' using errcode = '22023';
  end if;
  if p_bucket not in ('audio', 'notes')
     or p_kind not in ('playback', 'notes')
     or (p_kind = 'playback' and p_bucket <> 'audio')
     or (p_kind = 'notes' and p_bucket <> 'notes')
     or p_object_path like '%..%' then
    raise exception 'invalid artifact namespace' using errcode = '22023';
  end if;
  select target_song_id into strict v_target_song_id
  from public.requests where id = p_request_id;
  if position('_staging/' || p_request_id::text || '/' || p_attempt_id::text || '/' in p_object_path) <> 1
     and position(v_target_song_id || '/' in p_object_path) <> 1 then
    raise exception 'artifact path is not owned by request attempt' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.requests r
    join public.request_attempts a on a.request_id = r.id
    where r.id = p_request_id and a.id = p_attempt_id
      and r.status = 'processing' and r.lease_token = p_lease_token
      and r.lease_expires_at > clock_timestamp()
      and a.lease_token = p_lease_token and a.status in ('running','compensating')
  ) then
    raise exception 'artifact lease is stale' using errcode = '40001';
  end if;

  insert into public.request_artifacts(
    request_id, attempt_id, bucket, object_path, kind, sha256, size_bytes, state
  ) values (
    p_request_id, p_attempt_id, p_bucket, p_object_path, p_kind,
    lower(p_sha256), p_size_bytes, p_state
  )
  on conflict (bucket, object_path) do update set
    request_id = excluded.request_id,
    attempt_id = excluded.attempt_id,
    kind = excluded.kind,
    sha256 = excluded.sha256,
    size_bytes = excluded.size_bytes,
    state = excluded.state,
    updated_at = clock_timestamp()
  where (
      public.request_artifacts.request_id = excluded.request_id
      and public.request_artifacts.attempt_id = excluded.attempt_id
      and public.request_artifacts.kind = excluded.kind
      and public.request_artifacts.sha256 = excluded.sha256
      and public.request_artifacts.size_bytes = excluded.size_bytes
    )
    or (
      public.request_artifacts.request_id = excluded.request_id
      and public.request_artifacts.state = 'cleaned'
      and public.request_artifacts.kind = excluded.kind
    )
  returning id into v_id;
  if v_id is null then
    raise exception 'artifact ownership or hash conflict' using errcode = '23505';
  end if;
  return v_id;
end $$;

alter function public.acquire_next_modal_dispatch(text, integer)
  owner to worker_control_owner;
alter function public.record_request_artifact(uuid,uuid,uuid,text,text,text,text,bigint,text)
  owner to worker_control_owner;

revoke all on function public.acquire_next_modal_dispatch(text, integer)
  from public, anon, authenticated;
revoke all on function public.record_request_artifact(uuid,uuid,uuid,text,text,text,text,bigint,text)
  from public, anon, authenticated;

grant execute on function public.acquire_next_modal_dispatch(text, integer)
  to service_role;
grant execute on function public.record_request_artifact(uuid,uuid,uuid,text,text,text,text,bigint,text)
  to service_role;

revoke create on schema public from worker_control_owner;
revoke set option for worker_control_owner from current_user;

commit;
