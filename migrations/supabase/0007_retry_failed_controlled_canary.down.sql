begin;
grant worker_control_owner to current_user with set true;
set local role worker_control_owner;
drop function if exists public.requeue_failed_controlled_attempt(uuid, uuid, text);
reset role;
drop policy if exists songs_control_owner_insert on public.songs;
drop policy if exists songs_control_owner_select on public.songs;
revoke set option for worker_control_owner from current_user;
commit;
