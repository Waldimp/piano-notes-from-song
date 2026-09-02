-- =====================================================================
-- Piano Tutorial — esquema en Supabase (Postgres + Storage)
-- Ejecutar UNA vez en: Supabase Dashboard → SQL Editor → New query → Run
-- =====================================================================

-- Canciones publicadas (el contenido vive en Storage: audio + notes.json)
create table if not exists public.songs (
    id          text primary key,                 -- slug, igual que el id local
    title       text not null,
    filename    text not null,
    duration    double precision not null default 0,
    note_count  integer not null default 0,
    pedal_count integer not null default 0,
    engine      text not null default '',
    audio_path  text not null,                    -- ruta en bucket "audio"
    notes_path  text not null,                    -- ruta en bucket "notes"
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- Solicitudes de transcripcion (cola). El worker local las procesa cuando
-- esta encendido: queued -> processing -> done | error
create table if not exists public.requests (
    id           uuid primary key default gen_random_uuid(),
    filename     text not null,
    audio_path   text not null,                   -- ruta en bucket "uploads"
    status       text not null default 'queued'
                 check (status in ('queued', 'processing', 'done', 'error')),
    error        text,
    song_id      text references public.songs(id) on delete set null,
    requested_by uuid references auth.users(id) on delete set null,
    created_at   timestamptz not null default now(),
    started_at   timestamptz,
    finished_at  timestamptz
);

create index if not exists requests_status_created_idx
    on public.requests (status, created_at);

-- ---------------------------------------------------------------------
-- Seguridad: solo usuarios autenticados (tu y tu hermana) leen y escriben.
-- El worker/publicador local usa la service_role key y salta RLS.
-- ---------------------------------------------------------------------
alter table public.songs    enable row level security;
alter table public.requests enable row level security;

drop policy if exists "songs: leer autenticados"     on public.songs;
drop policy if exists "songs: renombrar autenticados" on public.songs;
drop policy if exists "songs: borrar autenticados"   on public.songs;
create policy "songs: leer autenticados"
    on public.songs for select to authenticated using (true);
create policy "songs: renombrar autenticados"
    on public.songs for update to authenticated using (true) with check (true);
create policy "songs: borrar autenticados"
    on public.songs for delete to authenticated using (true);

drop policy if exists "requests: leer autenticados"  on public.requests;
drop policy if exists "requests: crear autenticados" on public.requests;
create policy "requests: leer autenticados"
    on public.requests for select to authenticated using (true);
create policy "requests: crear autenticados"
    on public.requests for insert to authenticated
    with check (requested_by = auth.uid());

-- ---------------------------------------------------------------------
-- Storage: tres buckets privados (se sirven con URLs firmadas)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('audio', 'audio', false), ('notes', 'notes', false), ('uploads', 'uploads', false)
on conflict (id) do nothing;

drop policy if exists "storage: leer audio y notas"   on storage.objects;
drop policy if exists "storage: subir solicitudes"    on storage.objects;
drop policy if exists "storage: borrar audio y notas" on storage.objects;
create policy "storage: leer audio y notas"
    on storage.objects for select to authenticated
    using (bucket_id in ('audio', 'notes'));
create policy "storage: subir solicitudes"
    on storage.objects for insert to authenticated
    with check (bucket_id = 'uploads');
create policy "storage: borrar audio y notas"
    on storage.objects for delete to authenticated
    using (bucket_id in ('audio', 'notes'));

-- updated_at automatico en songs
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end $$;

drop trigger if exists songs_set_updated_at on public.songs;
create trigger songs_set_updated_at
    before update on public.songs
    for each row execute function public.set_updated_at();
