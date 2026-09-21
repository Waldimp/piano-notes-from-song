begin;
-- No safe down migration: restoring the prior definition reintroduces a
-- runtime error for every controlled requests update.
commit;
