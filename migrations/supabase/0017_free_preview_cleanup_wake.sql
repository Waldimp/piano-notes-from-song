-- 0017 FREE preview (60 s), expired-upload cleanup and pg_cron dispatch wake.
--
-- 1) FREE plan no longer rejects audio longer than plan_limits.max_duration_seconds:
--    the request is created with preview_seconds = max_duration_seconds and the
--    worker trims the audio BEFORE transcription (no GPU spent on the rest).
--    Paid plans keep duration_exceeded exactly as before.
-- 2) songs inherit preview_seconds / source_duration_seconds from their request
--    (server-owned; users cannot edit them).
-- 3) list_expired_uploads(): candidates in bucket "uploads" that no live request
--    needs anymore (preview sources are retained 30 days so the user can unlock).
-- 4) wake_dispatch_if_pending(): pg_cron (every minute) + pg_net call to the
--    Vercel recovery wake ONLY when the outbox has eligible work. Secrets live in
--    Vault (pianissimo_wake_url, pianissimo_cron_secret); if absent it is a no-op.
--
-- Does NOT touch billing flags, Modal limits, RLS ownership or credits math.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.requests
  add column if not exists preview_seconds integer
    check (preview_seconds is null or preview_seconds > 0);

alter table public.songs
  add column if not exists preview_seconds integer
    check (preview_seconds is null or preview_seconds > 0),
  add column if not exists source_duration_seconds double precision
    check (source_duration_seconds is null or source_duration_seconds > 0);

comment on column public.requests.preview_seconds is
  'When set, the worker transcribes only the first N seconds (FREE preview). NULL = full song.';
comment on column public.songs.preview_seconds is
  'Copied from the request at insert time. NULL = full tutorial.';
comment on column public.songs.source_duration_seconds is
  'Measured duration of the uploaded audio (full length), even when the tutorial is a preview.';

-- Column-level grants (0011 granted explicit column lists)
grant select (preview_seconds) on public.requests to authenticated;
grant select (preview_seconds, source_duration_seconds) on public.songs to authenticated;

-- ---------------------------------------------------------------------------
-- 2. songs inherit preview metadata from the request; users cannot change it
-- ---------------------------------------------------------------------------
create or replace function public.songs_inherit_request_preview()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_preview integer;
  v_measured double precision;
begin
  if new.request_id is not null then
    select preview_seconds, measured_duration_seconds
      into v_preview, v_measured
    from public.requests where id = new.request_id;
    new.preview_seconds := coalesce(new.preview_seconds, v_preview);
    new.source_duration_seconds := coalesce(new.source_duration_seconds, v_measured);
  end if;
  return new;
end $$;

revoke all on function public.songs_inherit_request_preview() from public, anon, authenticated;

drop trigger if exists songs_inherit_preview on public.songs;
create trigger songs_inherit_preview
before insert on public.songs
for each row execute function public.songs_inherit_request_preview();

create or replace function public.guard_song_preview_fields()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if current_user in ('anon', 'authenticated')
     and (new.preview_seconds is distinct from old.preview_seconds
          or new.source_duration_seconds is distinct from old.source_duration_seconds) then
    raise exception 'songs preview fields are server-owned' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists songs_guard_preview on public.songs;
create trigger songs_guard_preview
before update on public.songs
for each row execute function public.guard_song_preview_fields();

-- ---------------------------------------------------------------------------
-- 3. authorize_beta_request: FREE -> preview instead of rejection
-- ---------------------------------------------------------------------------
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
  v_preview integer := null;
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
    if v_ent.plan_code = 'free' then
      -- FREE: process only the first max_duration_seconds (preview). The worker
      -- trims before transcription; the full upload is retained for unlocking.
      v_preview := v_plan.max_duration_seconds;
    else
      return jsonb_build_object('ok', false, 'code', 'duration_exceeded',
        'message', format('Max duration for your plan is %s seconds.', v_plan.max_duration_seconds),
        'max_duration_seconds', v_plan.max_duration_seconds,
        'measured_duration_seconds', p_measured_duration_seconds);
    end if;
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
    filename, audio_path, requested_by, measured_duration_seconds, plan_code_at_enqueue,
    preview_seconds
  ) values (
    left(trim(p_filename), 240), p_audio_path, v_uid,
    p_measured_duration_seconds, v_ent.plan_code, v_preview
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
    jsonb_build_object('plan_code', v_ent.plan_code, 'preview_seconds', v_preview)
  ) returning id into v_ledger_id;

  update public.requests set credit_ledger_id = v_ledger_id where id = v_request.id;

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request.id,
    'credit_balance', v_ent.credit_balance,
    'plan_code', v_ent.plan_code,
    'measured_duration_seconds', p_measured_duration_seconds,
    'preview_seconds', v_preview
  );
end $$;

-- ---------------------------------------------------------------------------
-- 4. Expired uploads (bucket "uploads") — decision only; deletion via Storage API
-- ---------------------------------------------------------------------------
create or replace function public.list_expired_uploads(
  p_min_age_hours integer default 24,
  p_preview_retention_days integer default 30,
  p_limit integer default 200
)
returns table(object_name text, object_created_at timestamptz, reason text)
language sql
security definer
set search_path = pg_catalog
as $$
  with objs as (
    select o.name, o.created_at
    from storage.objects o
    where o.bucket_id = 'uploads'
      and o.created_at < clock_timestamp() - make_interval(hours => greatest(p_min_age_hours, 1))
  ),
  refs as (
    select r.audio_path,
           bool_or(r.status in ('queued', 'processing')) as has_live,
           bool_or(r.status in ('done', 'error')
                   and coalesce(r.finished_at, r.created_at)
                       > clock_timestamp() - make_interval(hours => greatest(p_min_age_hours, 1))) as has_recent_terminal,
           bool_or(r.status = 'done' and r.preview_seconds is not null
                   and coalesce(r.finished_at, r.created_at)
                       > clock_timestamp() - make_interval(days => greatest(p_preview_retention_days, 1))) as has_preview_to_unlock
    from public.requests r
    group by r.audio_path
  )
  select o.name, o.created_at,
         case when rf.audio_path is null then 'orphan'
              else 'terminal' end as reason
  from objs o
  left join refs rf on rf.audio_path = o.name
  where rf.audio_path is null
     or (not rf.has_live and not rf.has_recent_terminal and not rf.has_preview_to_unlock)
  order by o.created_at
  limit greatest(p_limit, 1);
$$;

revoke all on function public.list_expired_uploads(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.list_expired_uploads(integer, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 5. pg_cron + pg_net wake (fail-closed without Vault secrets)
-- ---------------------------------------------------------------------------
create extension if not exists pg_net;
create extension if not exists pg_cron;

create or replace function public.wake_dispatch_if_pending()
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_url text;
  v_secret text;
  v_pending integer;
  v_mode text;
  v_kill boolean;
begin
  select mode::text, kill_switch into v_mode, v_kill
  from public.worker_control where singleton = true;
  if v_mode is distinct from 'modal' or coalesce(v_kill, true) then
    return 'skipped:mode';
  end if;

  select count(*)::integer into v_pending
  from public.dispatch_outbox
  where state = 'pending' and available_at <= clock_timestamp();
  if v_pending = 0 then
    return 'idle';
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'pianissimo_wake_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'pianissimo_cron_secret';
  if v_url is null or v_secret is null then
    return 'skipped:no_vault_secrets';
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret,
                                  'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 8000
  );
  return format('woke:%s', v_pending);
end $$;

revoke all on function public.wake_dispatch_if_pending() from public, anon, authenticated, service_role;

do $$
begin
  perform cron.unschedule('pianissimo_wake_dispatch')
  where exists (select 1 from cron.job where jobname = 'pianissimo_wake_dispatch');
  perform cron.schedule('pianissimo_wake_dispatch', '* * * * *',
                        'select public.wake_dispatch_if_pending()');
end $$;
