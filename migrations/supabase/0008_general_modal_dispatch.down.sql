-- DOWN for 0008. Restores the previous record_request_artifact conflict rule
-- and removes acquire_next_modal_dispatch. Refuses while Modal work is active.
begin;

do $$
declare
  v_control public.worker_control%rowtype;
begin
  select * into strict v_control from public.worker_control where singleton = true for update;
  if v_control.mode = 'modal' and not v_control.kill_switch then
    raise exception 'rollback refused: modal dispatch is active' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.dispatch_outbox
    where state in ('leased', 'spawning', 'acknowledged')
  ) then
    raise exception 'rollback refused: active dispatch lease exists' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.requests
    where status = 'processing' and lease_expires_at > clock_timestamp()
  ) then
    raise exception 'rollback refused: active request lease exists' using errcode = '55000';
  end if;
end $$;

grant worker_control_owner to current_user with set true;
grant usage, create on schema public to worker_control_owner;

drop function if exists public.acquire_next_modal_dispatch(text, integer);

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
    state = excluded.state, updated_at = clock_timestamp()
  where public.request_artifacts.request_id = excluded.request_id
    and public.request_artifacts.attempt_id = excluded.attempt_id
    and public.request_artifacts.kind = excluded.kind
    and public.request_artifacts.sha256 = excluded.sha256
    and public.request_artifacts.size_bytes = excluded.size_bytes
  returning id into v_id;
  if v_id is null then
    raise exception 'artifact ownership or hash conflict' using errcode = '23505';
  end if;
  return v_id;
end $$;

alter function public.record_request_artifact(uuid,uuid,uuid,text,text,text,text,bigint,text)
  owner to worker_control_owner;
revoke all on function public.record_request_artifact(uuid,uuid,uuid,text,text,text,text,bigint,text)
  from public, anon, authenticated;
grant execute on function public.record_request_artifact(uuid,uuid,uuid,text,text,text,text,bigint,text)
  to service_role;

revoke create on schema public from worker_control_owner;
revoke set option for worker_control_owner from current_user;

commit;
