# Despliegue gratuito: Vercel + Supabase + worker local (GPU)

Arquitectura elegida en el decision gate (contrato §13/§26):

```text
Tu PC (GPU)                       Supabase (free)                Vercel (free)
────────────                      ───────────────                ─────────────
transcribir local (como hoy)  ──► Storage: audio + notes.json    Next.js lee de Supabase
"Publicar" / scripts/publish.py   Postgres: songs, requests      ◄── iPhone / tablet / PC
scripts/worker.py (manual)    ◄── cola "requests"               ◄── "Transcribir una canción"
```

- El modelo y la GPU se quedan en tu PC (RAM 1.8 GB: no cabe en planes gratis).
- Tu hermana entra con su cuenta desde cualquier dispositivo, ve la biblioteca,
  practica y puede **pedir** canciones: quedan en cola hasta que tú levantes el worker.
- Nada de tu red se expone a internet.

## 1. Supabase (una vez)

1. Crear proyecto en supabase.com (plan Free).
2. **SQL Editor → New query**: pegar y ejecutar `migrations/supabase/0001_init.sql`
   (tablas `songs`/`requests`, RLS, buckets `audio`/`notes`/`uploads`).
3. **Authentication → Sign In / Providers → Email**:
   - desactivar *Allow new users to sign up* (nadie más se registra),
   - desactivar *Confirm email* (los usuarios creados a mano entran directo).
4. **Authentication → Users → Add user**: crear tu usuario y el de tu hermana
   (correo + contraseña). Alternativa: `python scripts/create_user.py correo contraseña`.
5. **Authentication → Sessions**: dejar *Time-box user sessions* e *Inactivity timeout*
   en "never" (default). La sesión se renueva sola y no caduca hasta pulsar Salir.
6. Claves (Project Settings → API keys): `sb_publishable_...` (frontend) y
   `sb_secret_...` (solo tu PC y el servidor de Vercel).

## 2. Tu PC

En `.env` (raíz del repo, git-ignorado):

```ini
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
```

```powershell
.venv\Scripts\pip install -e .\apps\worker

# Publicar una canción ya transcrita (o botón "☁ Publicar" en la biblioteca local)
.venv\Scripts\python scripts\publish.py cut_liszt --title "Liszt"
.venv\Scripts\python scripts\publish.py --list

# Procesar solicitudes hechas desde el celular (levántalo cuando quieras)
.venv\Scripts\python scripts\worker.py          # revisa cada 15 s; Ctrl+C para salir
.venv\Scripts\python scripts\worker.py --once   # procesa lo pendiente y termina
```

## 3. Vercel (una vez)

1. vercel.com → *Add New Project* → importar `Waldimp/piano-notes-from-song`.
2. **Root Directory**: `apps/web` (Vercel detecta el workspace npm de la raíz).
3. **Environment Variables**:

   | Variable | Valor |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://TU-PROYECTO.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_...` |
   | `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_...` (solo la usa `/api/keepalive` en el servidor) |
   | `CRON_SECRET` | cadena aleatoria larga |

4. Deploy. Cada `git push` a `main` redespliega solo.
5. `apps/web/vercel.json` programa un cron diario a `/api/keepalive`: evita que
   Supabase pause el proyecto gratuito tras 7 días sin actividad.

## Modos de la app

- **Local** (sin `NEXT_PUBLIC_SUPABASE_URL`): habla con FastAPI en tu PC. Sin login.
- **Nube** (Vercel): habla con Supabase. Exige login. Las subidas crean solicitudes.

La UI es la misma; solo cambia la fuente de datos (`apps/web/src/lib/data/`).

## Límites del plan Free (referencia)

Supabase: 500 MB Postgres, 1 GB Storage (≈ 200 canciones de 3–5 MB), 5 GB de
descarga/mes (≈ 1000 reproducciones). Vercel Hobby: uso personal, 100 GB/mes.
