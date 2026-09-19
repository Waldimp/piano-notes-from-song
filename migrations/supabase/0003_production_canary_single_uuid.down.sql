-- Prepared locally; execute only after 0003 authorization is unused.
begin;

do $$
begin
  if exists (
    select 1 from public.production_canary_arm
    where request_id is not null and consumed_at is null
  ) then
    raise exception 'rollback refused: a production-canary UUID is armed';
  end if;
end $$;

drop function if exists public.reserve_production_canary_spawn(uuid,uuid,integer,bigint,text);
drop function if exists public.arm_production_canary_uuid(uuid);
drop table if exists public.production_canary_arm;

commit;
