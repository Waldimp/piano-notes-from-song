-- 0017 DOWN — reverses wake cron, cleanup RPC, preview trigger/guard and columns.
-- authorize_beta_request is restored to the 0011 behaviour (FREE rejects > max).
do $$
begin
  perform cron.unschedule('pianissimo_wake_dispatch')
  where exists (select 1 from cron.job where jobname = 'pianissimo_wake_dispatch');
end $$;
drop function if exists public.wake_dispatch_if_pending();
drop function if exists public.list_expired_uploads(integer, integer, integer);

drop trigger if exists songs_guard_preview on public.songs;
drop function if exists public.guard_song_preview_fields();
drop trigger if exists songs_inherit_preview on public.songs;
drop function if exists public.songs_inherit_request_preview();

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
      'message', 'You have used your free tutorials.', 'credit_balance', 0);
  end if;
  insert into public.requests(
    filename, audio_path, requested_by, measured_duration_seconds, plan_code_at_enqueue
  ) values (
    left(trim(p_filename), 240), p_audio_path, v_uid,
    p_measured_duration_seconds, v_ent.plan_code
  ) returning * into v_request;
  update public.account_entitlements
  set credit_balance = credit_balance - 1, updated_at = clock_timestamp()
  where user_id = v_uid and credit_balance >= 1
  returning credit_balance into v_ent.credit_balance;
  if not found then
    delete from public.requests where id = v_request.id;
    return jsonb_build_object('ok', false, 'code', 'no_credits',
      'message', 'You have used your free tutorials.');
  end if;
  insert into public.user_credit_ledger(user_id, request_id, delta, reason, status, metadata)
  values (v_uid, v_request.id, -1, 'reserve', 'reserved',
          jsonb_build_object('plan_code', v_ent.plan_code))
  returning id into v_ledger_id;
  update public.requests set credit_ledger_id = v_ledger_id where id = v_request.id;
  return jsonb_build_object('ok', true, 'request_id', v_request.id,
    'credit_balance', v_ent.credit_balance, 'plan_code', v_ent.plan_code,
    'measured_duration_seconds', p_measured_duration_seconds);
end $$;

revoke select (preview_seconds) on public.requests from authenticated;
revoke select (preview_seconds, source_duration_seconds) on public.songs from authenticated;
alter table public.songs drop column if exists preview_seconds, drop column if exists source_duration_seconds;
alter table public.requests drop column if exists preview_seconds;
