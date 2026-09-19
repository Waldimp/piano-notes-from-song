-- Rollback for 0002_modal_worker_controlled_staging.sql. Staging only.
begin;

-- Rollback is fail-closed.  Never remove the control metadata while a staged
-- object, active attempt, or durable dispatch receipt still needs it for
-- reconciliation.  The transaction aborts before any DROP in that case.
do $$
begin
  if exists (select 1 from storage.objects where name like '_staging/%') then
    raise exception 'rollback refused: storage contains _staging objects';
  end if;
  if exists (
    select 1
    from storage.objects o
    left join public.songs s
      on (o.bucket_id = 'audio' and s.audio_path = o.name)
      or (o.bucket_id = 'notes' and s.notes_path = o.name)
    where o.bucket_id in ('audio','notes')
      and split_part(o.name, '/', 1) <> '_staging'
      and s.id is null
  ) then
    raise exception 'rollback refused: canonical orphan object exists';
  end if;
  if exists (select 1 from public.request_attempts where status in ('running','compensating'))
     or exists (select 1 from public.dispatch_outbox where state in ('leased','spawning','acknowledged')) then
    raise exception 'rollback refused: active or ambiguous controlled work exists';
  end if;
  if exists (
    select 1 from public.request_artifacts
    where state = 'staged'
       or (state = 'committed' and position('_staging/' in object_path) = 1)
  ) then
    raise exception 'rollback refused: private artifact ownership remains';
  end if;
end $$;

drop trigger if exists songs_guard_controlled on public.songs;
drop trigger if exists requests_guard_controlled on public.requests;
drop trigger if exists requests_enqueue_controlled on public.requests;
drop trigger if exists requests_prepare_controlled on public.requests;
drop function if exists public.guard_controlled_mutation();
drop function if exists public.enqueue_controlled_request();
drop function if exists public.prepare_controlled_request();
drop function if exists public.claim_request(uuid,text,uuid,integer,bigint,integer);
drop function if exists public.heartbeat_request(uuid,uuid,uuid,integer);
drop function if exists public.finalize_request(uuid,uuid,uuid,text,text,text,double precision,integer,integer,text,text,text,jsonb);
drop function if exists public.inspect_attempt_outcome(uuid,uuid,uuid);
drop function if exists public.record_request_artifact(uuid,uuid,uuid,text,text,text,text,bigint,text);
drop function if exists public.mark_artifact_cleaned(uuid,uuid,uuid,text,text);
drop function if exists public.fail_request_attempt(uuid,uuid,uuid,text,text,boolean,integer);
drop function if exists public.acquire_dispatch_slot(text,bigint,integer);
drop function if exists public.acquire_local_dispatch(uuid,bigint,integer);
drop function if exists public.recover_expired_request(uuid,uuid,text);
drop function if exists public.reserve_worker_cost(uuid,uuid,numeric);
drop function if exists public.settle_worker_cost(bigint,numeric,numeric,jsonb);
drop function if exists public.release_worker_cost(bigint,text);
drop function if exists public.reserve_dispatch_spawn(uuid,uuid,integer,bigint,text);
drop function if exists public.bind_dispatch_cost_reservation(uuid,uuid,bigint);
drop function if exists public.authorize_dispatch_spawn(uuid,uuid,integer,bigint,text,bigint);
drop function if exists public.ack_dispatch(uuid,text,text);
drop function if exists public.return_unspawned_dispatch(uuid,text);
drop function if exists public.get_owned_artifact(uuid,uuid,uuid,text,text);
drop function if exists public.list_completed_staging_artifacts(integer);
drop function if exists public.mark_completed_staging_artifact_cleaned(uuid,uuid,text,text,text,bigint);
drop function if exists public.list_dispatch_reconciliation_candidates(integer,integer);
drop function if exists public.reconcile_dispatch(uuid,text,text,text);
drop function if exists public.consume_dispatch_auth_nonce(uuid,timestamptz);
drop function if exists public.set_worker_mode(bigint,public.worker_mode,text);
drop function if exists public.engage_worker_kill_switch(text);
drop function if exists public.clear_worker_kill_switch(bigint,text);

drop table if exists public.dispatch_reconciliations;
drop table if exists public.dispatch_auth_nonces;
drop table if exists public.request_artifacts;
drop table if exists public.request_attempts;
drop table if exists public.dispatch_outbox;
drop table if exists public.worker_cost_ledger;
drop table if exists public.worker_control_events;
drop table if exists public.worker_control;

drop index if exists public.songs_request_id_uidx;
alter table public.songs drop column if exists request_id;

drop index if exists public.requests_lease_idx;
drop index if exists public.requests_retry_ready_idx;
drop index if exists public.requests_target_song_id_uidx;
alter table public.requests
  drop column if exists target_song_id,
  drop column if exists attempt_count,
  drop column if exists max_attempts,
  drop column if exists next_attempt_at,
  drop column if exists worker_kind,
  drop column if exists lease_token,
  drop column if exists lease_expires_at,
  drop column if exists heartbeat_at,
  drop column if exists failure_code,
  drop column if exists trace_id;

-- Restore the baseline application's table privileges after the controlled
-- migration has been proven empty and removed.
revoke all on public.requests, public.songs from public, anon, authenticated;
grant select, insert on public.requests to authenticated;
grant select, update, delete on public.songs to authenticated;

drop policy if exists "storage: leer audio y notas" on storage.objects;
drop policy if exists "storage: borrar audio y notas" on storage.objects;
create policy "storage: leer audio y notas"
  on storage.objects for select to authenticated using (bucket_id in ('audio','notes'));
create policy "storage: borrar audio y notas"
  on storage.objects for delete to authenticated using (bucket_id in ('audio','notes'));

drop type if exists public.worker_mode;

-- Roles are deliberately retained as NOLOGIN with no object privileges. Hosted
-- Supabase may own memberships outside this migration, so dropping them would
-- make rollback non-deterministic. A platform administrator may remove them
-- after verifying pg_shdepend is empty.
revoke all on schema public from worker_control_admin, worker_control_owner;

commit;
