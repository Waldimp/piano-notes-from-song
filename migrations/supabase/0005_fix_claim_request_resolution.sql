-- Pin PostgreSQL's resolution of claim_request's output-column names.
begin;

grant worker_control_owner to current_user with set true;
grant usage, create on schema public to worker_control_owner;
set local role worker_control_owner;

create or replace function public.claim_request(
  p_request_id uuid, p_worker_kind text, p_dispatch_id uuid,
  p_attempt_no integer, p_worker_generation bigint,
  p_lease_seconds integer default 720
)
returns table(
  request_id uuid, filename text, audio_path text, target_song_id text,
  attempt_id uuid, lease_token uuid, trace_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_control public.worker_control%rowtype;
  v_request public.requests%rowtype;
  v_attempt_id uuid := gen_random_uuid();
  v_lease_token uuid := gen_random_uuid();
begin
  if p_worker_kind not in ('local', 'modal') then
    raise exception 'invalid worker kind' using errcode = '22023';
  end if;
  if p_lease_seconds < 60 or p_lease_seconds > 1800 then
    raise exception 'invalid lease duration' using errcode = '22023';
  end if;
  select * into strict v_control from public.worker_control where singleton = true for update;
  if v_control.kill_switch or v_control.mode::text <> p_worker_kind then
    raise exception 'worker mode does not permit claim' using errcode = '55000';
  end if;
  if v_control.generation <> p_worker_generation then
    raise exception 'stale worker generation' using errcode = '40001';
  end if;
  select * into strict v_request from public.requests where id = p_request_id for update;
  if v_request.status <> 'queued'
     or (v_request.next_attempt_at is not null and v_request.next_attempt_at > clock_timestamp())
     or v_request.song_id is not null
     or v_request.attempt_count + 1 <> p_attempt_no
     or p_attempt_no > v_request.max_attempts then
    raise exception 'request is not claimable' using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.dispatch_outbox d
    where d.dispatch_id = p_dispatch_id and d.request_id = p_request_id
      and d.attempt_no = p_attempt_no and d.worker_generation = p_worker_generation
      and d.state in ('leased', 'spawning', 'acknowledged')
  ) then
    raise exception 'dispatch receipt is not claimable' using errcode = '55000';
  end if;
  insert into public.request_attempts(
    id, request_id, attempt_no, dispatch_id, worker_kind, worker_generation,
    lease_token, status
  ) values (
    v_attempt_id, p_request_id, p_attempt_no, p_dispatch_id, p_worker_kind,
    p_worker_generation, v_lease_token, 'running'
  );
  update public.requests set
    status = 'processing', attempt_count = p_attempt_no,
    worker_kind = p_worker_kind, lease_token = v_lease_token,
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    heartbeat_at = clock_timestamp(), started_at = clock_timestamp(),
    finished_at = null, error = null, failure_code = null, next_attempt_at = null
  where id = p_request_id;
  return query select v_request.id, v_request.filename, v_request.audio_path,
    v_request.target_song_id, v_attempt_id, v_lease_token, v_request.trace_id;
end $$;
reset role;
revoke create on schema public from worker_control_owner;
revoke set option for worker_control_owner from current_user;

commit;
