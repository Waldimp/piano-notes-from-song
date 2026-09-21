-- DOWN for 0009: restore 0008 body (known ambiguous). Prefer re-apply 0009.
begin;
-- No-op structural DOWN; 0008 function remains the prior definition if needed.
-- Operators should re-apply 0008 SQL then 0009 rather than destructive DROP.
select 1;
commit;
