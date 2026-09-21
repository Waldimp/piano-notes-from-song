-- DOWN 0011: refuse full automatic rollback of beta isolation/entitlements.
-- Restoring permissive RLS or dropping credit ledgers would re-open cross-user access.
do $$
begin
  raise exception '0011 down refused: would re-open cross-user access or drop credit history';
end $$;
