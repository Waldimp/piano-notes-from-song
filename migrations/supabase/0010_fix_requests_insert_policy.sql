-- Restore authenticated INSERT policy for web uploads.
-- Production had WITH CHECK (false), which blocked all client inserts.
-- Matches 0001_init.sql intent: only the signed-in user may enqueue as themselves.

drop policy if exists "requests: crear autenticados" on public.requests;
create policy "requests: crear autenticados"
  on public.requests for insert to authenticated
  with check (requested_by = auth.uid());
