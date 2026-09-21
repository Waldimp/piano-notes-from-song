-- NEW.request_id exists only for songs.  Keep that record access inside the
-- songs-only branch so a requests update cannot resolve it.
begin;

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
  elsif tg_table_name = 'songs' and tg_op = 'UPDATE' then
    if new.request_id is distinct from old.request_id then
      raise exception 'songs.request_id is immutable' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

commit;
