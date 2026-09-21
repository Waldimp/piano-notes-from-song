-- 0011 Beta readiness: entitlements, user credit ledger, isolation RLS, finalize owner_id.
-- Does not modify migrations 0002–0010 bodies; replaces functions via CREATE OR REPLACE.

-- ---------------------------------------------------------------------
-- Plan catalog (editable without code redeploy for beta experiments)
-- ---------------------------------------------------------------------
create table if not exists public.plan_limits (
  plan_code text primary key
    check (plan_code in ('free', 'mini', 'practice', 'plus')),
  max_duration_seconds integer not null check (max_duration_seconds > 0),
  included_credits integer not null check (included_credits >= 0),
  max_active_requests integer not null default 1 check (max_active_requests > 0),
  requests_per_minute integer not null default 6 check (requests_per_minute > 0),
  description text not null default ''
);

insert into public.plan_limits(plan_code, max_duration_seconds, included_credits, max_active_requests, requests_per_minute, description)
values
  ('free', 60, 3, 1, 4, 'Free tier: 3 tutorials, 60s max'),
  ('mini', 600, 5, 1, 6, 'Mini pack: 5 credits, 10 min max'),
  ('practice', 600, 20, 1, 8, 'Practice: 20 credits/period, 10 min max'),
  ('plus', 600, 50, 1, 10, 'Plus: 50 credits/period, 10 min max')
on conflict (plan_code) do nothing;

-- ---------------------------------------------------------------------
-- Account entitlements + user credit ledger (distinct from worker_cost_ledger)
-- ---------------------------------------------------------------------
create table if not exists public.account_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_code text not null references public.plan_limits(plan_code),
  credit_balance integer not null default 0 check (credit_balance >= 0),
  period_ends_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists public.user_credit_ledger (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid references public.requests(id) on delete set null,
  delta integer not null,
  reason text not null
    check (reason in (
      'free_grant', 'plan_grant', 'admin_adjust',
      'reserve', 'settle', 'release'
    )),
  status text not null
    check (status in ('posted', 'reserved', 'settled', 'released')),
  created_at timestamptz not null default clock_timestamp(),
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists user_credit_ledger_one_open_reserve
  on public.user_credit_ledger(request_id)
  where reason = 'reserve' and status in ('reserved', 'settled');

create index if not exists user_credit_ledger_user_created_idx
  on public.user_credit_ledger(user_id, created_at desc);

create table if not exists public.rate_limit_events (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists rate_limit_events_user_action_created_idx
  on public.rate_limit_events(user_id, action, created_at desc);

-- ---------------------------------------------------------------------
-- Ownership on songs + measured duration on requests
-- ---------------------------------------------------------------------
alter table public.songs
  add column if not exists owner_id uuid references auth.users(id) on delete set null;

alter table public.requests
  add column if not exists measured_duration_seconds double precision,
  add column if not exists plan_code_at_enqueue text,
  add column if not exists credit_ledger_id bigint;

create index if not exists songs_owner_id_idx on public.songs(owner_id);
create index if not exists requests_requested_by_status_idx
  on public.requests(requested_by, status);

-- Backfill owner from request; orphan legacy rows → original account
update public.songs s
set owner_id = r.requested_by
from public.requests r
where s.request_id = r.id and s.owner_id is null and r.requested_by is not null;

update public.songs
set owner_id = 'b71ee4f6-44c8-4179-9280-9c83daaef6bd'
where owner_id is null;

-- ---------------------------------------------------------------------
-- RLS isolation (replace permissive authenticated policies)
-- ---------------------------------------------------------------------
alter table public.plan_limits enable row level security;
alter table public.account_entitlements enable row level security;
alter table public.user_credit_ledger enable row level security;
alter table public.rate_limit_events enable row level security;

revoke all on public.plan_limits from public, anon, authenticated;
revoke all on public.account_entitlements from public, anon, authenticated;
revoke all on public.user_credit_ledger from public, anon, authenticated;
revoke all on public.rate_limit_events from public, anon, authenticated;

grant select on public.plan_limits to authenticated;
grant select on public.account_entitlements to authenticated;
grant select on public.user_credit_ledger to authenticated;

drop policy if exists plan_limits_read on public.plan_limits;
create policy plan_limits_read on public.plan_limits
  for select to authenticated using (true);

drop policy if exists account_entitlements_select_own on public.account_entitlements;
create policy account_entitlements_select_own on public.account_entitlements
  for select to authenticated using (user_id = auth.uid());

drop policy if exists user_credit_ledger_select_own on public.user_credit_ledger;
create policy user_credit_ledger_select_own on public.user_credit_ledger
  for select to authenticated using (user_id = auth.uid());

-- requests / songs: own rows only
drop policy if exists "requests: leer autenticados" on public.requests;
create policy "requests: leer autenticados" on public.requests
  for select to authenticated using (requested_by = auth.uid());

drop policy if exists "songs: leer autenticados" on public.songs;
create policy "songs: leer autenticados" on public.songs
  for select to authenticated using (owner_id = auth.uid());

drop policy if exists "songs: renombrar autenticados" on public.songs;
create policy "songs: renombrar autenticados" on public.songs
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "songs: borrar autenticados" on public.songs;
create policy "songs: borrar autenticados" on public.songs
  for delete to authenticated using (owner_id = auth.uid());

-- Storage: uploads under {user_id}/... ; audio/notes only for owned songs
drop policy if exists "storage: subir solicitudes" on storage.objects;
create policy "storage: subir solicitudes" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'uploads'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "storage: leer uploads propios" on storage.objects;
create policy "storage: leer uploads propios" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'uploads'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "storage: leer audio y notas" on storage.objects;
create policy "storage: leer audio y notas" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('audio', 'notes')
    and split_part(name, '/', 1) <> '_staging'
    and exists (
      select 1 from public.songs s
      where s.owner_id = auth.uid()
        and (
          (bucket_id = 'audio' and s.audio_path = name)
          or (bucket_id = 'notes' and s.notes_path = name)
        )
    )
  );

drop policy if exists "storage: borrar audio y notas" on storage.objects;
create policy "storage: borrar audio y notas" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('audio', 'notes')
    and split_part(name, '/', 1) <> '_staging'
    and exists (
      select 1 from public.songs s
      where s.owner_id = auth.uid()
        and (
          (bucket_id = 'audio' and s.audio_path = name)
          or (bucket_id = 'notes' and s.notes_path = name)
        )
    )
  );

-- ---------------------------------------------------------------------
-- Entitlement / credit / rate-limit helpers
-- ---------------------------------------------------------------------
create or replace function public.ensure_account_entitlement(p_user_id uuid default auth.uid())
returns public.account_entitlements
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_row public.account_entitlements%rowtype;
  v_free public.plan_limits%rowtype;
begin
  if p_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if auth.uid() is not null and auth.uid() is distinct from p_user_id
     and current_user not in ('service_role', 'postgres') then
    raise exception 'cannot ensure entitlement for another user' using errcode = '42501';
  end if;

  select * into v_row from public.account_entitlements where user_id = p_user_id;
  if found then return v_row; end if;

  select * into strict v_free from public.plan_limits where plan_code = 'free';
  insert into public.account_entitlements(user_id, plan_code, credit_balance)
  values (p_user_id, 'free', v_free.included_credits)
  returning * into v_row;

  insert into public.user_credit_ledger(user_id, request_id, delta, reason, status, metadata)
  values (
    p_user_id, null, v_free.included_credits, 'free_grant', 'posted',
    jsonb_build_object('plan_code', 'free')
  );
  return v_row;
end $$;

create or replace function public.get_my_usage()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_ent public.account_entitlements%rowtype;
  v_plan public.plan_limits%rowtype;
  v_used integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  v_ent := public.ensure_account_entitlement(v_uid);
  select * into strict v_plan from public.plan_limits where plan_code = v_ent.plan_code;
  select count(*)::integer into v_used
  from public.user_credit_ledger
  where user_id = v_uid and reason = 'settle' and status = 'settled';
  return jsonb_build_object(
    'user_id', v_uid,
    'plan_code', v_ent.plan_code,
    'credit_balance', v_ent.credit_balance,
    'credits_settled', v_used,
    'max_duration_seconds', v_plan.max_duration_seconds,
    'max_active_requests', v_plan.max_active_requests,
    'requests_per_minute', v_plan.requests_per_minute,
    'period_ends_at', v_ent.period_ends_at
  );
end $$;

create or replace function public.check_beta_rate_limit(p_user_id uuid, p_action text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_plan public.plan_limits%rowtype;
  v_ent public.account_entitlements%rowtype;
  v_count integer;
begin
  v_ent := public.ensure_account_entitlement(p_user_id);
  select * into strict v_plan from public.plan_limits where plan_code = v_ent.plan_code;
  select count(*)::integer into v_count
  from public.rate_limit_events
  where user_id = p_user_id
    and action = p_action
    and created_at > clock_timestamp() - interval '1 minute';
  if v_count >= v_plan.requests_per_minute then
    return false;
  end if;
  insert into public.rate_limit_events(user_id, action) values (p_user_id, p_action);
  return true;
end $$;

create or replace function public.authorize_beta_request(
  p_filename text,
  p_audio_path text,
  p_measured_duration_seconds double precision
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_ent public.account_entitlements%rowtype;
  v_plan public.plan_limits%rowtype;
  v_active integer;
  v_request public.requests%rowtype;
  v_ledger_id bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_filename is null or length(trim(p_filename)) < 1 or length(p_filename) > 240 then
    raise exception 'invalid filename' using errcode = '22023';
  end if;
  if p_audio_path is null
     or split_part(p_audio_path, '/', 1) is distinct from v_uid::text
     or position('..' in p_audio_path) > 0 then
    raise exception 'audio_path must be owned by caller' using errcode = '42501';
  end if;
  if p_measured_duration_seconds is null or p_measured_duration_seconds <= 0 then
    raise exception 'invalid duration' using errcode = '22023';
  end if;

  v_ent := public.ensure_account_entitlement(v_uid);
  select * into strict v_plan from public.plan_limits where plan_code = v_ent.plan_code;

  if not public.check_beta_rate_limit(v_uid, 'create_request') then
    return jsonb_build_object('ok', false, 'code', 'rate_limited',
      'message', 'Too many requests. Wait a moment and try again.');
  end if;

  if p_measured_duration_seconds > v_plan.max_duration_seconds then
    return jsonb_build_object('ok', false, 'code', 'duration_exceeded',
      'message', format('Max duration for your plan is %s seconds.', v_plan.max_duration_seconds),
      'max_duration_seconds', v_plan.max_duration_seconds,
      'measured_duration_seconds', p_measured_duration_seconds);
  end if;

  select count(*)::integer into v_active
  from public.requests
  where requested_by = v_uid and status in ('queued', 'processing');
  if v_active >= v_plan.max_active_requests then
    return jsonb_build_object('ok', false, 'code', 'active_limit',
      'message', 'You already have a tutorial in progress.');
  end if;

  if v_ent.credit_balance < 1 then
    return jsonb_build_object('ok', false, 'code', 'no_credits',
      'message', 'You have used your free tutorials.',
      'credit_balance', 0);
  end if;

  insert into public.requests(
    filename, audio_path, requested_by, measured_duration_seconds, plan_code_at_enqueue
  ) values (
    left(trim(p_filename), 240), p_audio_path, v_uid,
    p_measured_duration_seconds, v_ent.plan_code
  ) returning * into v_request;

  update public.account_entitlements
  set credit_balance = credit_balance - 1,
      updated_at = clock_timestamp()
  where user_id = v_uid and credit_balance >= 1
  returning credit_balance into v_ent.credit_balance;
  if not found then
    delete from public.requests where id = v_request.id;
    return jsonb_build_object('ok', false, 'code', 'no_credits',
      'message', 'You have used your free tutorials.');
  end if;

  insert into public.user_credit_ledger(user_id, request_id, delta, reason, status, metadata)
  values (
    v_uid, v_request.id, -1, 'reserve', 'reserved',
    jsonb_build_object('plan_code', v_ent.plan_code)
  ) returning id into v_ledger_id;

  update public.requests set credit_ledger_id = v_ledger_id where id = v_request.id;

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request.id,
    'credit_balance', v_ent.credit_balance,
    'plan_code', v_ent.plan_code,
    'measured_duration_seconds', p_measured_duration_seconds
  );
end $$;

create or replace function public.settle_user_credit_for_request(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_row public.user_credit_ledger%rowtype;
begin
  select * into v_row from public.user_credit_ledger
  where request_id = p_request_id and reason = 'reserve'
  for update;
  if not found then return false; end if;
  if v_row.status = 'settled' then return true; end if;
  if v_row.status <> 'reserved' then return false; end if;
  update public.user_credit_ledger
  set status = 'settled',
      metadata = metadata || jsonb_build_object('settled_at', clock_timestamp())
  where id = v_row.id;
  return true;
end $$;

create or replace function public.release_user_credit_for_request(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_row public.user_credit_ledger%rowtype;
begin
  select * into v_row from public.user_credit_ledger
  where request_id = p_request_id and reason = 'reserve'
  for update;
  if not found then return false; end if;
  if v_row.status = 'released' then return true; end if;
  if v_row.status = 'settled' then return false; end if;
  if v_row.status <> 'reserved' then return false; end if;

  update public.user_credit_ledger
  set status = 'released',
      metadata = metadata || jsonb_build_object('released_at', clock_timestamp())
  where id = v_row.id;

  insert into public.user_credit_ledger(user_id, request_id, delta, reason, status, metadata)
  values (
    v_row.user_id, p_request_id, 1, 'release', 'posted',
    jsonb_build_object('from_ledger_id', v_row.id)
  );

  update public.account_entitlements
  set credit_balance = credit_balance + 1,
      updated_at = clock_timestamp()
  where user_id = v_row.user_id;
  return true;
end $$;

-- Admin-only plan assignment (service_role / postgres). Never exposed to browser.
create or replace function public.admin_set_account_entitlement(
  p_user_id uuid,
  p_plan_code text,
  p_credit_balance integer default null
)
returns public.account_entitlements
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_plan public.plan_limits%rowtype;
  v_row public.account_entitlements%rowtype;
  v_balance integer;
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select * into strict v_plan from public.plan_limits where plan_code = p_plan_code;
  v_balance := coalesce(p_credit_balance, v_plan.included_credits);
  insert into public.account_entitlements(user_id, plan_code, credit_balance)
  values (p_user_id, p_plan_code, v_balance)
  on conflict (user_id) do update
    set plan_code = excluded.plan_code,
        credit_balance = excluded.credit_balance,
        updated_at = clock_timestamp()
  returning * into v_row;
  insert into public.user_credit_ledger(user_id, request_id, delta, reason, status, metadata)
  values (
    p_user_id, null, v_balance, 'admin_adjust', 'posted',
    jsonb_build_object('plan_code', p_plan_code)
  );
  return v_row;
end $$;

-- ---------------------------------------------------------------------
-- Hook finalize / fail for owner_id + credit settle/release
-- ---------------------------------------------------------------------
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
    perform public.settle_user_credit_for_request(p_request_id);
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
    id, request_id, owner_id, title, filename, duration, note_count, pedal_count,
    engine, audio_path, notes_path
  ) values (
    p_song_id, p_request_id, v_request.requested_by, p_title, p_filename, p_duration,
    p_note_count, p_pedal_count, p_engine, p_audio_path, p_notes_path
  ) on conflict (id) do nothing;
  if not exists(select 1 from public.songs where id = p_song_id and request_id = p_request_id) then
    raise exception 'song ownership conflict' using errcode = '23505';
  end if;
  update public.songs set owner_id = coalesce(owner_id, v_request.requested_by)
  where id = p_song_id and request_id = p_request_id;

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

  perform public.settle_user_credit_for_request(p_request_id);
  return true;
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
declare v_request public.requests%rowtype; v_next timestamptz; v_result text;
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
    v_result := 'queued';
  else
    update public.requests set status = 'error', finished_at = clock_timestamp(),
      lease_token = null, lease_expires_at = null, heartbeat_at = null,
      failure_code = left(p_failure_code, 80), error = left(p_error, 500)
    where id = p_request_id;
    perform public.release_user_credit_for_request(p_request_id);
    v_result := 'error';
  end if;
  return v_result;
end $$;

-- Guard: authenticated cannot set measured_duration / plan / credit fields
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
       or new.trace_id is null
       or new.measured_duration_seconds is not null
       or new.plan_code_at_enqueue is not null
       or new.credit_ledger_id is not null then
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
       or new.status is distinct from old.status
       or new.measured_duration_seconds is distinct from old.measured_duration_seconds
       or new.plan_code_at_enqueue is distinct from old.plan_code_at_enqueue
       or new.credit_ledger_id is distinct from old.credit_ledger_id then
      raise exception 'server-owned request fields are immutable'
        using errcode = '42501';
    end if;
  elsif tg_table_name = 'songs' and tg_op = 'UPDATE' then
    if new.request_id is distinct from old.request_id then
      raise exception 'songs.request_id is immutable' using errcode = '42501';
    end if;
    if current_user in ('anon', 'authenticated')
       and new.owner_id is distinct from old.owner_id then
      raise exception 'songs.owner_id is immutable' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- Direct client INSERT into requests is no longer the beta path; only
-- SECURITY DEFINER authorize_beta_request may create rows for users.
revoke insert on public.requests from authenticated;

-- Keep SELECT grants for own rows (policy filters)
grant select (
  id, filename, status, error, song_id, created_at, requested_by,
  measured_duration_seconds, plan_code_at_enqueue
) on public.requests to authenticated;

grant select (
  id, title, filename, duration, note_count, pedal_count, engine,
  audio_path, notes_path, created_at, updated_at, request_id, owner_id
) on public.songs to authenticated;

revoke all on function public.ensure_account_entitlement(uuid) from public, anon;
revoke all on function public.get_my_usage() from public, anon;
revoke all on function public.check_beta_rate_limit(uuid, text) from public, anon, authenticated;
revoke all on function public.authorize_beta_request(text, text, double precision) from public, anon;
revoke all on function public.settle_user_credit_for_request(uuid) from public, anon, authenticated;
revoke all on function public.release_user_credit_for_request(uuid) from public, anon, authenticated;
revoke all on function public.admin_set_account_entitlement(uuid, text, integer) from public, anon, authenticated;

grant execute on function public.ensure_account_entitlement(uuid) to authenticated, service_role;
grant execute on function public.get_my_usage() to authenticated;
grant execute on function public.authorize_beta_request(text, text, double precision) to authenticated;
grant execute on function public.settle_user_credit_for_request(uuid) to service_role, worker_control_owner;
grant execute on function public.release_user_credit_for_request(uuid) to service_role, worker_control_owner;
grant execute on function public.admin_set_account_entitlement(uuid, text, integer) to service_role;
grant execute on function public.check_beta_rate_limit(uuid, text) to authenticated, service_role;

grant select, insert, update on public.account_entitlements to worker_control_owner;
grant select, insert, update on public.user_credit_ledger to worker_control_owner;
grant usage, select on sequence public.user_credit_ledger_id_seq to worker_control_owner;
grant select, insert on public.rate_limit_events to worker_control_owner;
grant usage, select on sequence public.rate_limit_events_id_seq to worker_control_owner;
grant select on public.plan_limits to worker_control_owner;

