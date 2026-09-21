-- DOWN for 0010: refuse to re-break authenticated inserts.
-- Restoring WITH CHECK (false) would block the web upload path.
do $$
begin
  raise exception '0010 down refused: would re-break authenticated request inserts';
end $$;
