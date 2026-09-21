begin;
-- No safe down migration: restoring the prior definition reintroduces the
-- runtime ambiguity in a production control-plane function.
commit;
