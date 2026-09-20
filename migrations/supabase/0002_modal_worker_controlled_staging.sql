-- Controlled Modal worker migration. Apply ONLY to an isolated staging project.
-- Production application is explicitly out of scope.
begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'worker_control_owner') then
    create role worker_control_owner nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'worker_control_admin') then
    create role worker_control_admin nologin;
  end if;
end $$;

-- PostgreSQL requires membership in a target owner role for ALTER OWNER.
-- The membership is revoked before commit.
grant worker_control_owner to current_user;

do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'worker_mode'
  ) then
    create type public.worker_mode as enum ('local', 'modal', 'paused');
  end if;
end $$;

alter table public.requests
  add column if not exists target_song_id text,
  add column if not exists attempt_count integer not null default 0 check (attempt_count >= 0),
  add column if not exists max_attempts integer not null default 2 check (max_attempts between 1 and 5),
  add column if not exists next_attempt_at timestamptz,
  add column if not exists worker_kind text check (worker_kind in ('local', 'modal')),
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists failure_code text,
  add column if not exists trace_id uuid not null default gen_random_uuid();

update public.requests
set target_song_id = coalesce(song_id, 'song_' || replace(id::text, '-', ''))
where target_song_id is null;

alter table public.requests alter column target_song_id set not null;
create unique index if not exists requests_target_song_id_uidx
  on public.requests(target_song_id);
create index if not exists requests_retry_ready_idx
  on public.requests(status, next_attempt_at, created_at);
create index if not exists requests_lease_idx
  on public.requests(status, lease_expires_at)
  where status = 'processing';

alter table public.songs
  add column if not exists request_id uuid references public.requests(id);
create unique index if not exists songs_request_id_uidx
  on public.songs(request_id) where request_id is not null;

create table if not exists public.worker_control (
  singleton boolean primary key default true check (singleton),
  mode public.worker_mode not null default 'paused',
  kill_switch boolean not null default true,
  generation bigint not null default 1 check (generation > 0),
  changed_at timestamptz not null default now(),
  changed_by text not null default current_user,
  reason text not null default 'initial staging lock' check (length(trim(reason)) > 0)
);

insert into public.worker_control(singleton, mode, kill_switch, generation, reason)
values (true, 'paused', true, 1, 'initial staging lock')
on conflict (singleton) do nothing;

create table if not exists public.worker_control_events (
  id bigint generated always as identity primary key,
  old_mode public.worker_mode,
  new_mode public.worker_mode not null,
  old_kill_switch boolean,
  new_kill_switch boolean not null,
  generation bigint not null,
  actor text not null,
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.request_attempts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  attempt_no integer not null check (attempt_no > 0),
  dispatch_id uuid not null,
  worker_kind text not null check (worker_kind in ('local', 'modal')),
  worker_generation bigint not null,
  lease_token uuid not null unique,
  status text not null check (
    status in ('running', 'retry_scheduled', 'lost', 'succeeded', 'failed', 'compensating')
  ),
  modal_call_id text,
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  finished_at timestamptz,
  failure_code text,
  error text,
  metrics jsonb not null default '{}'::jsonb,
  unique(request_id, attempt_no),
  unique(dispatch_id)
);

create index if not exists request_attempts_active_idx
  on public.request_attempts(request_id, heartbeat_at)
  where status in ('running', 'compensating');

create table if not exists public.request_artifacts (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.requests(id) on delete cascade,
  attempt_id uuid not null references public.request_attempts(id) on delete cascade,
  bucket text not null check (bucket in ('audio', 'notes')),
  object_path text not null,
  kind text not null check (kind in ('playback', 'notes')),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null check (size_bytes >= 0),
  state text not null check (state in ('staged', 'committed', 'cleaned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(bucket, object_path)
);

create table if not exists public.dispatch_outbox (
  dispatch_id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  attempt_no integer not null check (attempt_no > 0),
  worker_generation bigint not null,
  state text not null default 'pending' check (
    state in ('pending', 'leased', 'spawning', 'acknowledged', 'closed', 'failed')
  ),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  delivery_count integer not null default 0 check (delivery_count >= 0),
  modal_call_id text,
  cost_reservation_id bigint,
  acknowledged_at timestamptz,
  reconciled_at timestamptz,
  reconciliation_count integer not null default 0 check (reconciliation_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(request_id, attempt_no)
);

create index if not exists dispatch_outbox_ready_idx
  on public.dispatch_outbox(state, available_at, created_at);

create index if not exists dispatch_outbox_reconcile_idx
  on public.dispatch_outbox(state, updated_at)
  where state in ('spawning', 'acknowledged');

create table if not exists public.dispatch_reconciliations (
  id bigint generated always as identity primary key,
  dispatch_id uuid not null references public.dispatch_outbox(dispatch_id) on delete cascade,
  observation_id text not null,
  observed_state text not null check (observed_state in ('accepted', 'not_found')),
  modal_call_id text,
  observed_at timestamptz not null default clock_timestamp(),
  unique(dispatch_id, observation_id)
);

create table if not exists public.dispatch_auth_nonces (
  nonce uuid primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);

create or replace function public.consume_dispatch_auth_nonce(
  p_nonce uuid, p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_expires_at <= clock_timestamp()
     or p_expires_at > clock_timestamp() + interval '5 minutes' then
    return false;
  end if;
  delete from public.dispatch_auth_nonces where expires_at <= clock_timestamp();
  insert into public.dispatch_auth_nonces(nonce, expires_at)
  values (p_nonce, p_expires_at)
  on conflict (nonce) do nothing;
  return found;
end $$;

create table if not exists public.worker_cost_ledger (
  id bigint generated always as identity primary key,
  request_id uuid references public.requests(id),
  attempt_id uuid references public.request_attempts(id),
  kind text not null check (kind in ('reservation', 'observed', 'release')),
  amount_usd numeric(12, 8) not null check (amount_usd >= 0),
  gpu_seconds numeric(14, 4),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

alter table public.dispatch_outbox
  drop constraint if exists dispatch_outbox_cost_reservation_fkey,
  add constraint dispatch_outbox_cost_reservation_fkey
    foreign key (cost_reservation_id) references public.worker_cost_ledger(id);

create or replace function public.reserve_worker_cost(
  p_request_id uuid, p_attempt_id uuid, p_estimated_usd numeric
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_spend numeric; v_id bigint; v_control public.worker_control%rowtype;
begin
  if p_estimated_usd <= 0 or p_estimated_usd > 1 then
    raise exception 'invalid cost reservation' using errcode = '22023';
  end if;
  select * into strict v_control from public.worker_control where singleton = true for update;
  if v_control.kill_switch then return null; end if;
  select coalesce(sum(case kind when 'release' then -amount_usd else amount_usd end), 0)
    into v_spend from public.worker_cost_ledger;
  if v_spend + p_estimated_usd > 20.00 then
    update public.worker_control set kill_switch = true,
      generation = v_control.generation + 1, changed_at = clock_timestamp(),
      changed_by = session_user, reason = 'automatic staging hard stop at USD 20'
    where singleton = true;
    insert into public.worker_control_events(
      old_mode,new_mode,old_kill_switch,new_kill_switch,generation,actor,reason
    ) values (
      v_control.mode,v_control.mode,v_control.kill_switch,true,
      v_control.generation + 1,session_user,'automatic staging hard stop at USD 20'
    );
    return null;
  end if;
  insert into public.worker_cost_ledger(request_id,attempt_id,kind,amount_usd)
  values (p_request_id,p_attempt_id,'reservation',p_estimated_usd)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.settle_worker_cost(
  p_reservation_id bigint, p_observed_usd numeric, p_gpu_seconds numeric,
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_reservation public.worker_cost_ledger%rowtype;
begin
  select * into strict v_reservation from public.worker_cost_ledger
    where id = p_reservation_id and kind = 'reservation' for update;
  if exists (
    select 1 from public.worker_cost_ledger
    where kind = 'release' and metadata->>'reservation_id' = p_reservation_id::text
  ) then return true; end if;
  insert into public.worker_cost_ledger(
    request_id,attempt_id,kind,amount_usd,gpu_seconds,metadata
  ) values (
    v_reservation.request_id,v_reservation.attempt_id,'observed',p_observed_usd,
    p_gpu_seconds,coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('reservation_id',p_reservation_id)
  );
  insert into public.worker_cost_ledger(request_id,attempt_id,kind,amount_usd,metadata)
  values (
    v_reservation.request_id,v_reservation.attempt_id,'release',v_reservation.amount_usd,
    jsonb_build_object('reservation_id',p_reservation_id)
  );
  return true;
end $$;

create or replace function public.release_worker_cost(
  p_reservation_id bigint, p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_reservation public.worker_cost_ledger%rowtype;
begin
  select * into strict v_reservation from public.worker_cost_ledger
    where id = p_reservation_id and kind = 'reservation' for update;
  if exists (
    select 1 from public.worker_cost_ledger
    where kind = 'release' and metadata->>'reservation_id' = p_reservation_id::text
  ) then return true; end if;
  insert into public.worker_cost_ledger(request_id,attempt_id,kind,amount_usd,metadata)
  values (
    v_reservation.request_id,v_reservation.attempt_id,'release',v_reservation.amount_usd,
    jsonb_build_object('reservation_id',p_reservation_id,'reason',left(p_reason,120))
  );
  return true;
end $$;

create or replace function public.prepare_controlled_request()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  -- The request UUID is the sole source of the controlled song identity.
  new.target_song_id := 'song_' || replace(new.id::text, '-', '');
  return new;
end $$;

create or replace function public.enqueue_controlled_request()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_generation bigint;
begin
  select generation into v_generation
  from public.worker_control where singleton = true;
  insert into public.dispatch_outbox(request_id, attempt_no, worker_generation)
  values (new.id, 1, v_generation);
  return new;
end $$;

-- Direct table writes are not the control plane.  Keep the public request
-- insert contract narrow and make all server-owned fields immutable to users.
create or replace function public.guard_controlled_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_table_name = 'requests' and tg_op = 'INSERT'
     and current_user in ('anon', 'authenticated') then
    if new.status <> 'queued' or new.song_id is not null
       or new.target_song_id is not null or new.attempt_count <> 0
       or new.worker_kind is not null or new.lease_token is not null
       or new.trace_id is null then
      raise exception 'server-owned request fields cannot be supplied'
        using errcode = '42501';
    end if;
  elsif tg_table_name = 'requests' and tg_op = 'UPDATE'
     and current_user in ('anon', 'authenticated') then
    if new.id is distinct from old.id
       or new.target_song_id is distinct from old.target_song_id
       or new.attempt_count is distinct from old.attempt_count
       or new.max_attempts is distinct from old.max_attempts
       or new.next_attempt_at is distinct from old.next_attempt_at
       or new.worker_kind is distinct from old.worker_kind
       or new.lease_token is distinct from old.lease_token
       or new.lease_expires_at is distinct from old.lease_expires_at
       or new.heartbeat_at is distinct from old.heartbeat_at
       or new.failure_code is distinct from old.failure_code
       or new.trace_id is distinct from old.trace_id
       or new.song_id is distinct from old.song_id
       or new.status is distinct from old.status then
      raise exception 'server-owned request fields are immutable'
        using errcode = '42501';
    end if;
  elsif tg_table_name = 'songs' and tg_op = 'UPDATE'
     and new.request_id is distinct from old.request_id then
    raise exception 'songs.request_id is immutable' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists requests_guard_controlled on public.requests;
create trigger requests_guard_controlled
before insert or update on public.requests
for each row execute function public.guard_controlled_mutation();

drop trigger if exists songs_guard_controlled on public.songs;
create trigger songs_guard_controlled
before update on public.songs
for each row execute function public.guard_controlled_mutation();

drop trigger if exists requests_prepare_controlled on public.requests;
create trigger requests_prepare_controlled
before insert on public.requests
for each row execute function public.prepare_controlled_request();

drop trigger if exists requests_enqueue_controlled on public.requests;
create trigger requests_enqueue_controlled
after insert on public.requests
for each row execute function public.enqueue_controlled_request();

create or replace function public.claim_request(
  p_request_id uuid,
  p_worker_kind text,
  p_dispatch_id uuid,
  p_attempt_no integer,
  p_worker_generation bigint,
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

  select * into strict v_control
  from public.worker_control where singleton = true for update;
  if v_control.kill_switch or v_control.mode::text <> p_worker_kind then
    raise exception 'worker mode does not permit claim' using errcode = '55000';
  end if;
  if v_control.generation <> p_worker_generation then
    raise exception 'stale worker generation' using errcode = '40001';
  end if;

  select * into strict v_request
  from public.requests where id = p_request_id for update;
  if v_request.status <> 'queued'
     or (v_request.next_attempt_at is not null and v_request.next_attempt_at > clock_timestamp())
     or v_request.song_id is not null
     or v_request.attempt_count + 1 <> p_attempt_no
     or p_attempt_no > v_request.max_attempts then
    raise exception 'request is not claimable' using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.dispatch_outbox
    where dispatch_id = p_dispatch_id and request_id = p_request_id
      and attempt_no = p_attempt_no and worker_generation = p_worker_generation
      and state in ('leased', 'spawning', 'acknowledged')
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

create or replace function public.heartbeat_request(
  p_request_id uuid, p_attempt_id uuid, p_lease_token uuid, p_extend_seconds integer default 720
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_updated integer; v_attempt_updated integer;
begin
  if p_extend_seconds < 60 or p_extend_seconds > 1800 then
    raise exception 'invalid heartbeat duration' using errcode = '22023';
  end if;
  update public.requests set
    heartbeat_at = clock_timestamp(),
    lease_expires_at = clock_timestamp() + make_interval(secs => p_extend_seconds)
  where id = p_request_id and status = 'processing' and lease_token = p_lease_token
    and lease_expires_at > clock_timestamp()
    and exists (
      select 1 from public.request_attempts
      where id = p_attempt_id and request_id = p_request_id
        and lease_token = p_lease_token and status = 'running'
    );
  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    update public.request_attempts set heartbeat_at = clock_timestamp()
    where id = p_attempt_id and request_id = p_request_id
      and lease_token = p_lease_token and status = 'running';
    get diagnostics v_attempt_updated = row_count;
  else
    v_attempt_updated := 0;
  end if;
  return v_updated = 1 and v_attempt_updated = 1;
end $$;

create or replace function public.finalize_request(
  p_request_id uuid, p_attempt_id uuid, p_lease_token uuid,
  p_song_id text, p_title text, p_filename text, p_duration double precision,
  p_note_count integer, p_pedal_count integer, p_engine text,
  p_audio_path text, p_notes_path text, p_metrics jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_request public.requests%rowtype;
begin
  select * into strict v_request from public.requests
  where id = p_request_id for update;
  if v_request.status = 'done' and v_request.song_id = p_song_id then
    return exists (
      select 1 from public.request_attempts
      where id = p_attempt_id and request_id = p_request_id
        and lease_token = p_lease_token and status = 'succeeded'
    );
  end if;
  if v_request.status <> 'processing' or v_request.lease_token <> p_lease_token
     or v_request.lease_expires_at <= clock_timestamp()
     or v_request.target_song_id <> p_song_id then
    raise exception 'stale finalization' using errcode = '40001';
  end if;
  if exists(select 1 from public.songs where id = p_song_id and request_id <> p_request_id) then
    raise exception 'song ownership conflict' using errcode = '23505';
  end if;
  if not exists (
    select 1 from public.request_artifacts
    where request_id = p_request_id and attempt_id = p_attempt_id
      and kind = 'playback' and state = 'committed' and object_path = p_audio_path
  ) or not exists (
    select 1 from public.request_artifacts
    where request_id = p_request_id and attempt_id = p_attempt_id
      and kind = 'notes' and state = 'committed' and object_path = p_notes_path
  ) then
    raise exception 'committed artifacts are incomplete or not owned by attempt'
      using errcode = '55000';
  end if;
  if p_audio_path not like p_song_id || '/%'
     or p_notes_path not like p_song_id || '/%'
     or position('_staging/' in p_audio_path) > 0
     or position('_staging/' in p_notes_path) > 0 then
    raise exception 'final song paths must be canonical and non-staging'
      using errcode = '22023';
  end if;

  insert into public.songs(
    id, request_id, title, filename, duration, note_count, pedal_count,
    engine, audio_path, notes_path
  ) values (
    p_song_id, p_request_id, p_title, p_filename, p_duration, p_note_count,
    p_pedal_count, p_engine, p_audio_path, p_notes_path
  ) on conflict (id) do nothing;
  if not exists(select 1 from public.songs where id = p_song_id and request_id = p_request_id) then
    raise exception 'song ownership conflict' using errcode = '23505';
  end if;

  update public.request_attempts set status = 'succeeded', finished_at = clock_timestamp(),
    metrics = coalesce(p_metrics, '{}'::jsonb)
  where id = p_attempt_id and request_id = p_request_id
    and lease_token = p_lease_token and status = 'running';
  if not found then raise exception 'attempt is not active' using errcode = '40001'; end if;

  update public.requests set status = 'done', song_id = p_song_id,
    finished_at = clock_timestamp(), error = null, failure_code = null,
    lease_token = null, lease_expires_at = null, heartbeat_at = null
  where id = p_request_id;
  update public.dispatch_outbox set state = 'closed', updated_at = clock_timestamp()
  where dispatch_id = (select dispatch_id from public.request_attempts where id = p_attempt_id);
  return true;
end $$;

create or replace function public.inspect_attempt_outcome(
  p_request_id uuid, p_attempt_id uuid, p_lease_token uuid
)
returns text
language sql
security definer
set search_path = pg_catalog
stable
as $$
  select case
    when r.status = 'done' and a.status = 'succeeded'
      and s.request_id = r.id then 'done_owned'
    when r.status = 'processing' and r.lease_token = p_lease_token
      and r.lease_expires_at > clock_timestamp()
      and a.status in ('running','compensating') then 'active_owned'
    else 'stale_or_ambiguous'
  end
  from public.requests r
  join public.request_attempts a on a.request_id = r.id and a.id = p_attempt_id
  left join public.songs s on s.id = r.song_id
  where r.id = p_request_id and a.lease_token = p_lease_token
$$;

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
declare v_id bigint; v_target_song_id text;
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

create or replace function public.get_owned_artifact(
  p_request_id uuid, p_attempt_id uuid, p_lease_token uuid,
  p_bucket text, p_object_path text
)
returns table(sha256 text, size_bytes bigint, state text)
language sql
security definer
set search_path = pg_catalog
as $$
  select a.sha256, a.size_bytes, a.state
  from public.request_artifacts a
  join public.requests r on r.id = a.request_id
  join public.request_attempts ra on ra.id = a.attempt_id and ra.request_id = a.request_id
  where a.request_id = p_request_id and a.attempt_id = p_attempt_id
    and a.bucket = p_bucket and a.object_path = p_object_path
    and r.status = 'processing' and r.lease_token = p_lease_token
     and r.lease_expires_at > clock_timestamp()
    and ra.lease_token = p_lease_token and ra.status in ('running','compensating')
$$;

create or replace function public.list_completed_staging_artifacts(
  p_limit integer default 100
)
returns table(
  request_id uuid, attempt_id uuid, bucket text, object_path text,
  sha256 text, size_bytes bigint
)
language sql
security definer
set search_path = pg_catalog
as $$
  select a.request_id, a.attempt_id, a.bucket, a.object_path, a.sha256, a.size_bytes
  from public.request_artifacts a
  join public.requests r on r.id = a.request_id
  join public.request_attempts ra on ra.id = a.attempt_id and ra.request_id = a.request_id
  where r.status = 'done' and ra.status = 'succeeded'
    and a.state in ('staged','committed')
    and position('_staging/' || a.request_id::text || '/' || a.attempt_id::text || '/' in a.object_path) = 1
  order by a.updated_at
  limit least(greatest(p_limit, 1), 500)
$$;

create or replace function public.mark_completed_staging_artifact_cleaned(
  p_request_id uuid, p_attempt_id uuid, p_bucket text, p_object_path text,
  p_sha256 text, p_size_bytes bigint
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  update public.request_artifacts a set state = 'cleaned', updated_at = clock_timestamp()
  where a.request_id = p_request_id and a.attempt_id = p_attempt_id
    and a.bucket = p_bucket and a.object_path = p_object_path
    and a.sha256 = lower(p_sha256) and a.size_bytes = p_size_bytes
    and a.state in ('staged','committed')
    and exists (select 1 from public.requests r where r.id = a.request_id and r.status = 'done')
    and exists (select 1 from public.request_attempts ra
      where ra.id = a.attempt_id and ra.request_id = a.request_id and ra.status = 'succeeded');
  return found;
end $$;

create or replace function public.mark_artifact_cleaned(
  p_request_id uuid, p_attempt_id uuid, p_lease_token uuid,
  p_bucket text, p_object_path text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1 from public.request_attempts
    where id = p_attempt_id and request_id = p_request_id
      and lease_token = p_lease_token and status in ('running','compensating')
      and exists (
        select 1 from public.requests
        where id = p_request_id and status = 'processing'
          and lease_token = p_lease_token and lease_expires_at > clock_timestamp()
      )
  ) then
    raise exception 'artifact cleanup lease is stale' using errcode = '40001';
  end if;
  update public.request_artifacts set state = 'cleaned', updated_at = clock_timestamp()
  where request_id = p_request_id and attempt_id = p_attempt_id
    and bucket = p_bucket and object_path = p_object_path
    and state in ('staged','committed');
  return found;
end $$;

create or replace function public.fail_request_attempt(
  p_request_id uuid, p_attempt_id uuid, p_lease_token uuid,
  p_failure_code text, p_error text, p_retryable boolean,
  p_backoff_seconds integer default 60
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_request public.requests%rowtype; v_next timestamptz;
begin
  select * into strict v_request from public.requests where id = p_request_id for update;
  if v_request.status <> 'processing' or v_request.lease_token <> p_lease_token
     or v_request.lease_expires_at is null
     or v_request.lease_expires_at <= clock_timestamp() then
    raise exception 'stale failure report' using errcode = '40001';
  end if;
  update public.request_attempts set
    status = case when p_retryable and v_request.attempt_count < v_request.max_attempts
      then 'retry_scheduled' else 'failed' end,
    failure_code = left(p_failure_code, 80), error = left(p_error, 500),
    finished_at = clock_timestamp()
  where id = p_attempt_id and lease_token = p_lease_token and status in ('running', 'compensating');
  if not found then raise exception 'attempt is not active' using errcode = '40001'; end if;

  update public.dispatch_outbox set state = 'closed', updated_at = clock_timestamp()
  where dispatch_id = (select dispatch_id from public.request_attempts where id = p_attempt_id);

  if p_retryable and v_request.attempt_count < v_request.max_attempts then
    v_next := clock_timestamp() + make_interval(secs => greatest(1, p_backoff_seconds));
    update public.requests set status = 'queued', next_attempt_at = v_next,
      worker_kind = null, lease_token = null, lease_expires_at = null,
      heartbeat_at = null, failure_code = left(p_failure_code, 80),
      error = left(p_error, 500), finished_at = null
    where id = p_request_id;
    insert into public.dispatch_outbox(request_id, attempt_no, worker_generation, available_at)
    select p_request_id, v_request.attempt_count + 1, generation, v_next
    from public.worker_control where singleton = true;
    return 'queued';
  end if;

  update public.requests set status = 'error', finished_at = clock_timestamp(),
    lease_token = null, lease_expires_at = null, heartbeat_at = null,
    failure_code = left(p_failure_code, 80), error = left(p_error, 500)
  where id = p_request_id;
  return 'error';
end $$;

create or replace function public.acquire_dispatch_slot(
  p_dispatcher_id text, p_worker_generation bigint, p_lease_seconds integer default 30
)
returns table(dispatch_id uuid, request_id uuid, attempt_no integer, worker_generation bigint)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_control public.worker_control%rowtype; v_dispatch public.dispatch_outbox%rowtype;
begin
  select * into strict v_control from public.worker_control where singleton = true for update;
  if v_control.mode <> 'modal' or v_control.kill_switch or v_control.generation <> p_worker_generation then
    return;
  end if;
  update public.dispatch_outbox set state = 'pending', lease_owner = null,
    lease_expires_at = null, updated_at = clock_timestamp(),
    last_error = 'dispatcher lease expired before spawn reservation'
  where state = 'leased' and lease_expires_at < clock_timestamp();
  if exists(select 1 from public.dispatch_outbox where state in ('leased','spawning','acknowledged')) then
    return;
  end if;
  select * into v_dispatch from public.dispatch_outbox
  where state = 'pending' and available_at <= clock_timestamp()
    and worker_generation = v_control.generation
  order by available_at, created_at for update skip locked limit 1;
  if not found then return; end if;
  update public.dispatch_outbox set state = 'leased', lease_owner = left(p_dispatcher_id, 120),
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    delivery_count = delivery_count + 1, updated_at = clock_timestamp()
  where dispatch_id = v_dispatch.dispatch_id;
  return query select v_dispatch.dispatch_id, v_dispatch.request_id,
    v_dispatch.attempt_no, v_dispatch.worker_generation;
end $$;

-- The legacy/local worker may still choose work using its existing queue logic,
-- but it must reserve exactly that UUID before invoking the common claim RPC.
create or replace function public.acquire_local_dispatch(
  p_request_id uuid, p_worker_generation bigint, p_lease_seconds integer default 30
)
returns table(dispatch_id uuid, request_id uuid, attempt_no integer, worker_generation bigint)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_control public.worker_control%rowtype; v_dispatch public.dispatch_outbox%rowtype;
begin
  select * into strict v_control from public.worker_control where singleton = true for update;
  if v_control.mode <> 'local' or v_control.kill_switch
     or v_control.generation <> p_worker_generation then
    return;
  end if;
  select * into v_dispatch from public.dispatch_outbox
  where request_id = p_request_id and state = 'pending'
    and worker_generation = v_control.generation
    and available_at <= clock_timestamp()
  order by attempt_no desc for update skip locked limit 1;
  if not found then return; end if;
  update public.dispatch_outbox set state = 'leased', lease_owner = 'local-worker',
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    delivery_count = delivery_count + 1, updated_at = clock_timestamp()
  where dispatch_id = v_dispatch.dispatch_id;
  return query select v_dispatch.dispatch_id, v_dispatch.request_id,
    v_dispatch.attempt_no, v_dispatch.worker_generation;
end $$;

create or replace function public.recover_expired_request(
  p_request_id uuid, p_expected_lease_token uuid, p_failure_code text default 'lease_expired'
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_request public.requests%rowtype; v_attempt public.request_attempts%rowtype;
  v_reservation_id bigint;
begin
  select * into strict v_request from public.requests where id = p_request_id for update;
  if v_request.status <> 'processing' or v_request.lease_token <> p_expected_lease_token
     or v_request.lease_expires_at is null
     or v_request.lease_expires_at >= clock_timestamp() then
    return 'not_expired';
  end if;
  select * into strict v_attempt from public.request_attempts
  where request_id = p_request_id and lease_token = p_expected_lease_token for update;
  select cost_reservation_id into v_reservation_id
  from public.dispatch_outbox where dispatch_id = v_attempt.dispatch_id for update;
  if v_reservation_id is not null then
    perform public.release_worker_cost(v_reservation_id, 'lease expired before completion');
  end if;
  update public.request_attempts set status = 'lost', finished_at = clock_timestamp(),
    failure_code = left(p_failure_code, 80), error = 'lease expired; manual recovery'
  where id = v_attempt.id;
  update public.dispatch_outbox set state = 'closed', updated_at = clock_timestamp(),
    cost_reservation_id = null
  where dispatch_id = v_attempt.dispatch_id;
  if v_request.attempt_count < v_request.max_attempts then
    update public.requests set status = 'queued', worker_kind = null,
      lease_token = null, lease_expires_at = null, heartbeat_at = null,
      next_attempt_at = clock_timestamp(), failure_code = left(p_failure_code, 80),
      error = 'lease expired; retry scheduled', finished_at = null
    where id = p_request_id;
    insert into public.dispatch_outbox(request_id, attempt_no, worker_generation)
    select p_request_id, v_request.attempt_count + 1, generation
    from public.worker_control where singleton = true;
    return 'queued';
  end if;
  update public.requests set status = 'error', lease_token = null,
    lease_expires_at = null, heartbeat_at = null, finished_at = clock_timestamp(),
    failure_code = left(p_failure_code, 80), error = 'lease expired; attempts exhausted'
  where id = p_request_id;
  return 'error';
end $$;

drop function if exists public.reserve_dispatch_spawn(uuid,uuid,integer,bigint);
create or replace function public.reserve_dispatch_spawn(
  p_dispatch_id uuid, p_request_id uuid, p_attempt_no integer,
  p_worker_generation bigint, p_lease_owner text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_dispatch public.dispatch_outbox%rowtype;
  v_control public.worker_control%rowtype;
begin
  if p_lease_owner is null or length(trim(p_lease_owner)) = 0 then
    return 'stale';
  end if;
  -- Lock order is control row then outbox row, identical to the dispatcher
  -- slot RPC.  The checks therefore happen in the transaction immediately
  -- preceding the external spawn authorization.
  select * into strict v_control from public.worker_control
    where singleton = true for update;
  select * into strict v_dispatch from public.dispatch_outbox
    where dispatch_id = p_dispatch_id for update;
  if v_dispatch.request_id <> p_request_id or v_dispatch.attempt_no <> p_attempt_no
     or v_dispatch.worker_generation <> p_worker_generation
     or v_dispatch.lease_owner is distinct from left(p_lease_owner, 120) then
    return 'stale';
  end if;
  if v_dispatch.state = 'acknowledged' then return 'replay'; end if;
  if v_control.mode <> 'modal' or v_control.kill_switch
     or v_control.generation <> p_worker_generation then
    return 'stale';
  end if;
  if v_dispatch.state = 'spawning' then return 'ambiguous'; end if;
  if v_dispatch.state <> 'leased' then return 'stale'; end if;
  if v_dispatch.lease_expires_at is null or v_dispatch.lease_expires_at <= clock_timestamp() then
    return 'stale';
  end if;
  update public.dispatch_outbox set state = 'spawning', updated_at = clock_timestamp()
  where dispatch_id = p_dispatch_id;
  return 'spawn';
end $$;

create or replace function public.bind_dispatch_cost_reservation(
  p_dispatch_id uuid, p_request_id uuid, p_reservation_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  update public.dispatch_outbox d set cost_reservation_id = p_reservation_id,
    updated_at = clock_timestamp()
  where d.dispatch_id = p_dispatch_id and d.request_id = p_request_id
    and d.state = 'spawning' and d.cost_reservation_id is null
    and exists (
      select 1 from public.worker_cost_ledger c
      where c.id = p_reservation_id and c.kind = 'reservation'
        and c.request_id = p_request_id
    );
  return found;
end $$;

create or replace function public.authorize_dispatch_spawn(
  p_dispatch_id uuid, p_request_id uuid, p_attempt_no integer,
  p_worker_generation bigint, p_lease_owner text, p_reservation_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_control public.worker_control%rowtype; v_dispatch public.dispatch_outbox%rowtype;
begin
  -- This is the final DB gate.  The caller must invoke it directly before
  -- Modal's spawn call; a stale generation, kill switch, or expired lease
  -- cannot authorize the call.
  select * into strict v_control from public.worker_control
    where singleton = true for update;
  select * into strict v_dispatch from public.dispatch_outbox
    where dispatch_id = p_dispatch_id for update;
  if v_control.mode <> 'modal' or v_control.kill_switch
     or v_control.generation <> p_worker_generation
     or v_dispatch.request_id <> p_request_id
     or v_dispatch.attempt_no <> p_attempt_no
     or v_dispatch.worker_generation <> p_worker_generation
     or v_dispatch.state <> 'spawning'
     or v_dispatch.lease_owner is distinct from left(p_lease_owner, 120)
     or v_dispatch.lease_expires_at is null
     or v_dispatch.lease_expires_at <= clock_timestamp()
     or v_dispatch.cost_reservation_id is distinct from p_reservation_id
     or not exists (
       select 1 from public.worker_cost_ledger
       where id = p_reservation_id and kind = 'reservation'
         and request_id = p_request_id
         and not exists (
           select 1 from public.worker_cost_ledger r
           where r.kind = 'release'
             and r.metadata->>'reservation_id' = p_reservation_id::text
         )
     ) then
    return false;
  end if;
  return true;
end $$;

drop function if exists public.ack_dispatch(uuid,text);
create or replace function public.ack_dispatch(
  p_dispatch_id uuid, p_lease_owner text, p_modal_call_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_modal_call_id is null or length(trim(p_modal_call_id)) = 0 then
    raise exception 'modal call id is required' using errcode = '22023';
  end if;
  update public.dispatch_outbox set state = 'acknowledged',
    modal_call_id = left(p_modal_call_id, 200), acknowledged_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where dispatch_id = p_dispatch_id and state in ('spawning', 'acknowledged')
    and lease_owner is not distinct from left(p_lease_owner, 120)
    and (modal_call_id is null or modal_call_id = left(p_modal_call_id, 200));
  return found;
end $$;

create or replace function public.return_unspawned_dispatch(
  p_dispatch_id uuid, p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  update public.dispatch_outbox set state = 'pending', lease_owner = null,
    lease_expires_at = null, cost_reservation_id = null,
    last_error = left(p_reason, 300),
    updated_at = clock_timestamp()
  where dispatch_id = p_dispatch_id and state = 'spawning' and modal_call_id is null;
  return found;
end $$;

create or replace function public.list_dispatch_reconciliation_candidates(
  p_limit integer default 20, p_min_age_seconds integer default 30
)
returns table(
  dispatch_id uuid, request_id uuid, attempt_no integer,
  worker_generation bigint, state text, lease_owner text,
  modal_call_id text, updated_at timestamptz
)
language sql
security definer
set search_path = pg_catalog
as $$
  select d.dispatch_id, d.request_id, d.attempt_no, d.worker_generation,
    d.state, d.lease_owner, d.modal_call_id, d.updated_at
  from public.dispatch_outbox d
  where d.state in ('spawning', 'acknowledged')
    and d.updated_at <= clock_timestamp() - make_interval(secs => greatest(1, p_min_age_seconds))
  order by d.updated_at
  limit least(greatest(p_limit, 1), 100)
$$;

create or replace function public.reconcile_dispatch(
  p_dispatch_id uuid, p_observation_id text, p_observed_state text,
  p_modal_call_id text default null
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_dispatch public.dispatch_outbox%rowtype;
begin
  if p_observation_id is null or length(trim(p_observation_id)) = 0
     or p_observed_state not in ('accepted', 'not_found') then
    raise exception 'invalid reconciliation observation' using errcode = '22023';
  end if;
  if p_observed_state = 'accepted'
     and (p_modal_call_id is null or length(trim(p_modal_call_id)) = 0) then
    raise exception 'accepted reconciliation requires modal call id' using errcode = '22023';
  end if;
  if p_observed_state = 'not_found' and p_modal_call_id is not null then
    raise exception 'not-found reconciliation cannot carry a call id' using errcode = '22023';
  end if;
  select * into strict v_dispatch from public.dispatch_outbox
    where dispatch_id = p_dispatch_id for update;
  insert into public.dispatch_reconciliations(
    dispatch_id, observation_id, observed_state, modal_call_id
  ) values (
    p_dispatch_id, left(p_observation_id, 200), p_observed_state,
    left(p_modal_call_id, 200)
  ) on conflict (dispatch_id, observation_id) do nothing;

  if p_observed_state = 'accepted' then
    if v_dispatch.state not in ('spawning', 'acknowledged')
       or (v_dispatch.modal_call_id is not null
           and v_dispatch.modal_call_id <> left(p_modal_call_id, 200)) then
      return 'stale';
    end if;
    update public.dispatch_outbox set state = 'acknowledged',
      modal_call_id = left(p_modal_call_id, 200), acknowledged_at = coalesce(acknowledged_at, clock_timestamp()),
      reconciled_at = clock_timestamp(), reconciliation_count = reconciliation_count + 1,
      updated_at = clock_timestamp()
    where dispatch_id = p_dispatch_id;
    return 'acknowledged';
  end if;

  if v_dispatch.state <> 'spawning' or v_dispatch.modal_call_id is not null then
    return 'stale';
  end if;
  if v_dispatch.cost_reservation_id is not null then
    perform public.release_worker_cost(
      v_dispatch.cost_reservation_id, 'spawn reconciled as not found'
    );
  end if;
  -- Only an explicit Modal-side not-found observation may reopen a spawn.  An
  -- unknown/timeout observation remains spawning and can never be redelivered.
  update public.dispatch_outbox set state = 'pending', lease_owner = null,
    lease_expires_at = null, available_at = clock_timestamp(),
    cost_reservation_id = null,
    reconciled_at = clock_timestamp(), reconciliation_count = reconciliation_count + 1,
    last_error = 'reconciled: external call not found', updated_at = clock_timestamp()
  where dispatch_id = p_dispatch_id;
  return 'requeued';
end $$;

create or replace function public.set_worker_mode(
  p_expected_generation bigint, p_new_mode public.worker_mode, p_reason text
)
returns table(mode public.worker_mode, generation bigint, changed_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_control public.worker_control%rowtype; v_now timestamptz := clock_timestamp();
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'reason is required' using errcode = '22023';
  end if;
  select * into strict v_control from public.worker_control where singleton = true for update;
  if v_control.generation <> p_expected_generation then
    raise exception 'stale generation' using errcode = '40001';
  end if;
  if v_control.mode = p_new_mode
     or (v_control.mode = 'local' and p_new_mode = 'modal')
     or (v_control.mode = 'modal' and p_new_mode = 'local') then
    raise exception 'invalid mode transition' using errcode = '22023';
  end if;
  if exists(select 1 from public.requests where status = 'processing')
     or exists(select 1 from public.request_attempts where status in ('running','compensating')) then
    raise exception 'active or unreconciled leases exist' using errcode = '55000';
  end if;
  update public.worker_control set mode = p_new_mode, generation = v_control.generation + 1,
    changed_at = v_now, changed_by = session_user, reason = p_reason
  where singleton = true;
  update public.dispatch_outbox set worker_generation = v_control.generation + 1,
    updated_at = v_now
  where state = 'pending';
  update public.dispatch_outbox set state = 'pending', lease_owner = null,
    lease_expires_at = null, worker_generation = v_control.generation + 1,
    last_error = 'dispatch invalidated by worker mode generation', updated_at = v_now
  where state = 'leased';
  insert into public.worker_control_events(
    old_mode,new_mode,old_kill_switch,new_kill_switch,generation,actor,reason,created_at
  ) values (
    v_control.mode,p_new_mode,v_control.kill_switch,v_control.kill_switch,
    v_control.generation + 1,session_user,p_reason,v_now
  );
  return query select p_new_mode, v_control.generation + 1, v_now;
end $$;

create or replace function public.engage_worker_kill_switch(p_reason text)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_control public.worker_control%rowtype;
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'reason is required' using errcode = '22023';
  end if;
  select * into strict v_control from public.worker_control where singleton = true for update;
  update public.worker_control set kill_switch = true, generation = v_control.generation + 1,
    changed_at = clock_timestamp(), changed_by = session_user, reason = p_reason
  where singleton = true;
  update public.dispatch_outbox set state = 'pending', lease_owner = null,
    lease_expires_at = null, worker_generation = v_control.generation + 1,
    last_error = 'dispatch invalidated by kill switch', updated_at = clock_timestamp()
  where state = 'leased';
  insert into public.worker_control_events(
    old_mode,new_mode,old_kill_switch,new_kill_switch,generation,actor,reason
  ) values (
    v_control.mode,v_control.mode,v_control.kill_switch,true,
    v_control.generation + 1,session_user,p_reason
  );
  return v_control.generation + 1;
end $$;

create or replace function public.clear_worker_kill_switch(
  p_expected_generation bigint, p_reason text
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_control public.worker_control%rowtype;
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'reason is required' using errcode = '22023';
  end if;
  select * into strict v_control from public.worker_control where singleton = true for update;
  if v_control.generation <> p_expected_generation then
    raise exception 'stale generation' using errcode = '40001';
  end if;
  if exists(select 1 from public.requests where status = 'processing')
     or exists(select 1 from public.request_attempts where status in ('running','compensating')) then
    raise exception 'active leases exist' using errcode = '55000';
  end if;
  update public.worker_control set kill_switch = false, generation = v_control.generation + 1,
    changed_at = clock_timestamp(), changed_by = session_user, reason = p_reason
  where singleton = true;
  update public.dispatch_outbox set worker_generation = v_control.generation + 1,
    updated_at = clock_timestamp()
  where state = 'pending';
  update public.dispatch_outbox set state = 'pending', lease_owner = null,
    lease_expires_at = null, worker_generation = v_control.generation + 1,
    last_error = 'dispatch re-enabled after kill switch', updated_at = clock_timestamp()
  where state = 'leased';
  insert into public.worker_control_events(
    old_mode,new_mode,old_kill_switch,new_kill_switch,generation,actor,reason
  ) values (
    v_control.mode,v_control.mode,v_control.kill_switch,false,
    v_control.generation + 1,session_user,p_reason
  );
  return v_control.generation + 1;
end $$;

-- New control-plane tables are server-only.
alter table public.worker_control enable row level security;
alter table public.worker_control_events enable row level security;
alter table public.request_attempts enable row level security;
alter table public.request_artifacts enable row level security;
alter table public.dispatch_outbox enable row level security;
alter table public.worker_cost_ledger enable row level security;
alter table public.dispatch_reconciliations enable row level security;
alter table public.dispatch_auth_nonces enable row level security;

revoke all on public.worker_control, public.worker_control_events,
  public.request_attempts, public.request_artifacts, public.dispatch_outbox,
  public.worker_cost_ledger, public.dispatch_reconciliations
  , public.dispatch_auth_nonces
  from public, anon, authenticated, service_role;
revoke insert, update, delete on public.worker_control, public.worker_control_events,
  public.request_attempts, public.request_artifacts, public.dispatch_outbox,
  public.worker_cost_ledger, public.dispatch_reconciliations,
  public.dispatch_auth_nonces from service_role;

-- Preserve the legacy UI's narrow user operations while removing all direct
-- writes to server-owned request/song columns.  Every worker mutation goes
-- through the RPCs below.
revoke all on public.requests, public.songs from public, anon, authenticated;
grant select (id, filename, status, error, song_id, created_at) on public.requests to authenticated;
grant insert (filename, audio_path, requested_by) on public.requests to authenticated;
grant select (id, title, filename, duration, note_count, pedal_count, engine,
  audio_path, notes_path, created_at, updated_at) on public.songs to authenticated;
grant update (title), delete on public.songs to authenticated;

-- Existing authenticated Storage access must never expose staging prefixes.
drop policy if exists "storage: leer audio y notas" on storage.objects;
drop policy if exists "storage: borrar audio y notas" on storage.objects;
create policy "storage: leer audio y notas"
  on storage.objects for select to authenticated
  using (
    bucket_id in ('audio','notes') and split_part(name, '/', 1) <> '_staging'
    and exists (
      select 1 from public.songs s
      where (storage.objects.bucket_id = 'audio' and s.audio_path = storage.objects.name)
         or (storage.objects.bucket_id = 'notes' and s.notes_path = storage.objects.name)
    )
  );
create policy "storage: borrar audio y notas"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('audio','notes') and split_part(name, '/', 1) <> '_staging'
    and exists (
      select 1 from public.songs s
      where (storage.objects.bucket_id = 'audio' and s.audio_path = storage.objects.name)
         or (storage.objects.bucket_id = 'notes' and s.notes_path = storage.objects.name)
    )
  );

grant usage on schema public to worker_control_owner, worker_control_admin;
grant select, insert, update on public.requests, public.songs,
  public.request_attempts, public.request_artifacts, public.dispatch_outbox,
  public.worker_cost_ledger, public.dispatch_reconciliations to worker_control_owner;
grant select, insert, delete on public.dispatch_auth_nonces to worker_control_owner;
grant select, update on public.worker_control to worker_control_owner;
grant insert on public.worker_control_events to worker_control_owner;
grant usage, select on sequence public.worker_control_events_id_seq,
  public.request_artifacts_id_seq, public.dispatch_reconciliations_id_seq,
  public.worker_cost_ledger_id_seq to worker_control_owner;

-- Make every SECURITY DEFINER function in this migration run with the
-- non-login control owner, never with the migration/session superuser.
do $$
declare v_function record;
begin
  for v_function in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.proname in (
        'reserve_worker_cost','settle_worker_cost','release_worker_cost',
        'prepare_controlled_request','enqueue_controlled_request','claim_request',
        'heartbeat_request','finalize_request','inspect_attempt_outcome',
        'get_owned_artifact','list_completed_staging_artifacts',
        'mark_completed_staging_artifact_cleaned','record_request_artifact','mark_artifact_cleaned',
        'fail_request_attempt','acquire_dispatch_slot','acquire_local_dispatch',
        'recover_expired_request','reserve_dispatch_spawn','authorize_dispatch_spawn',
        'bind_dispatch_cost_reservation','ack_dispatch','return_unspawned_dispatch',
        'list_dispatch_reconciliation_candidates',
        'reconcile_dispatch','set_worker_mode','engage_worker_kill_switch',
        'clear_worker_kill_switch','consume_dispatch_auth_nonce'
      )
  loop
    execute format('alter function public.%I(%s) owner to worker_control_owner',
      v_function.proname, v_function.args);
  end loop;
end $$;

alter function public.set_worker_mode(bigint, public.worker_mode, text)
  owner to worker_control_owner;
alter function public.engage_worker_kill_switch(text) owner to worker_control_owner;
alter function public.clear_worker_kill_switch(bigint, text) owner to worker_control_owner;

revoke all on function public.set_worker_mode(bigint, public.worker_mode, text)
  from public, anon, authenticated, service_role;
revoke all on function public.engage_worker_kill_switch(text)
  from public, anon, authenticated, service_role;
revoke all on function public.clear_worker_kill_switch(bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.set_worker_mode(bigint, public.worker_mode, text)
  to worker_control_admin;
grant execute on function public.engage_worker_kill_switch(text)
  to worker_control_admin;
grant execute on function public.clear_worker_kill_switch(bigint, text)
  to worker_control_admin;

revoke all on function public.claim_request(uuid,text,uuid,integer,bigint,integer),
  public.heartbeat_request(uuid,uuid,uuid,integer),
  public.finalize_request(uuid,uuid,uuid,text,text,text,double precision,integer,integer,text,text,text,jsonb),
  public.inspect_attempt_outcome(uuid,uuid,uuid),
  public.record_request_artifact(uuid,uuid,uuid,text,text,text,text,bigint,text),
  public.mark_artifact_cleaned(uuid,uuid,uuid,text,text),
  public.fail_request_attempt(uuid,uuid,uuid,text,text,boolean,integer),
  public.acquire_dispatch_slot(text,bigint,integer),
  public.acquire_local_dispatch(uuid,bigint,integer),
  public.recover_expired_request(uuid,uuid,text),
  public.reserve_worker_cost(uuid,uuid,numeric),
  public.settle_worker_cost(bigint,numeric,numeric,jsonb),
  public.release_worker_cost(bigint,text),
  public.reserve_dispatch_spawn(uuid,uuid,integer,bigint,text),
  public.authorize_dispatch_spawn(uuid,uuid,integer,bigint,text,bigint),
  public.bind_dispatch_cost_reservation(uuid,uuid,bigint),
  public.ack_dispatch(uuid,text,text),
  public.return_unspawned_dispatch(uuid,text),
  public.get_owned_artifact(uuid,uuid,uuid,text,text),
  public.list_completed_staging_artifacts(integer),
  public.mark_completed_staging_artifact_cleaned(uuid,uuid,text,text,text,bigint),
  public.list_dispatch_reconciliation_candidates(integer,integer),
  public.reconcile_dispatch(uuid,text,text,text)
  , public.consume_dispatch_auth_nonce(uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_request(uuid,text,uuid,integer,bigint,integer),
  public.heartbeat_request(uuid,uuid,uuid,integer),
  public.finalize_request(uuid,uuid,uuid,text,text,text,double precision,integer,integer,text,text,text,jsonb),
  public.inspect_attempt_outcome(uuid,uuid,uuid),
  public.record_request_artifact(uuid,uuid,uuid,text,text,text,text,bigint,text),
  public.mark_artifact_cleaned(uuid,uuid,uuid,text,text),
  public.fail_request_attempt(uuid,uuid,uuid,text,text,boolean,integer),
  public.acquire_dispatch_slot(text,bigint,integer),
  public.acquire_local_dispatch(uuid,bigint,integer),
  public.recover_expired_request(uuid,uuid,text),
  public.reserve_worker_cost(uuid,uuid,numeric),
  public.settle_worker_cost(bigint,numeric,numeric,jsonb),
  public.release_worker_cost(bigint,text),
  public.reserve_dispatch_spawn(uuid,uuid,integer,bigint,text),
  public.authorize_dispatch_spawn(uuid,uuid,integer,bigint,text,bigint),
  public.bind_dispatch_cost_reservation(uuid,uuid,bigint),
  public.ack_dispatch(uuid,text,text),
  public.return_unspawned_dispatch(uuid,text),
  public.get_owned_artifact(uuid,uuid,uuid,text,text),
  public.list_completed_staging_artifacts(integer),
  public.mark_completed_staging_artifact_cleaned(uuid,uuid,text,text,text,bigint),
  public.list_dispatch_reconciliation_candidates(integer,integer),
  public.reconcile_dispatch(uuid,text,text,text)
  , public.consume_dispatch_auth_nonce(uuid,timestamptz)
  to service_role;

revoke worker_control_owner from current_user;

commit;
