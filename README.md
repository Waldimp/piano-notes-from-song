# Pianissimo

Convierte una grabación de piano en un tutorial interactivo de notas que caen sobre un
teclado de 88 teclas, con velocidad ajustable, loop A/B, separación aproximada de manos y
nombres de notas. Web (PWA-friendly) para escritorio, iPhone y tablet.

```text
audio de piano → transcripción con IA (High-Resolution Piano Transcription, GPU)
             → notes.json normalizado (+ audio de reproducción AAC)
             → reproductor de notas que caen en el navegador
```

Producción: `https://piano-notes-from-song.vercel.app` (beta cerrada). El estado
operativo canónico vive en [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md) y las
decisiones en [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Arquitectura (estado real, septiembre 2026)

```text
Navegador (Next.js en Vercel)
  │  login Supabase Auth · RLS por usuario · créditos por plan
  │  upload → Storage "uploads" → POST /api/create-request (authorize_beta_request)
  ▼
Supabase (Postgres + Storage)
  │  requests → dispatch_outbox → wake (create-request · navegador · pg_cron cada minuto · cron Vercel diario)
  ▼
Edge Function dispatch-modal-staging → Modal T4 (worker Python)
  │  claim → descarga → [recorte a 60 s si es preview FREE] → transcripción → publica → finalize
  ▼
songs + audio/notes en Storage → tutorial en el navegador
```

- **Planes** (`plan_limits`): FREE 3 créditos con **vista previa de 60 s** de cualquier
  canción; Mini Pack 5 créditos / 10 min; Practice 20 y Plus 50 (suscripciones, flag apagado).
- **Pagos**: Wompi El Salvador. Mini Pack en sandbox (sin cobros reales) hasta cutover
  explícito; ver [`docs/WOMPI_INTEGRATION.md`](docs/WOMPI_INTEGRATION.md).
- **Worker local** (`scripts/worker.py`, panel en la web local): solo fallback con
  `worker_control.mode = local`.

## Estructura del monorepo

```text
apps/web/         Next.js 15 + React 19 + Canvas 2D (frontend; modo nube y modo local)
apps/api/         FastAPI local (biblioteca local, jobs locales, publicar, panel de cola)
apps/worker/      piano_worker: runner controlado (Modal/local), publicación, preview, cola
ml/               piano_ml: engine High-Resolution, preprocesamiento FFmpeg, recorte, contratos
packages/contracts/  Tipos TypeScript del contrato PianoTranscription v1
migrations/supabase/ 0001–0017 (UP/DOWN) — estado real de producción: 0002–0017 aplicadas
supabase/functions/  Edge Function del despachador
benchmarks/modal/    Laboratorio Modal (T4/L4) y definición desplegable del worker
scripts/          CLI local, canary/producción, worker, publicación, SMTP, benchmark
docs/             Estado, decisiones, runbooks, billing, beta, correo, deploy
```

## Desarrollo local

Prerrequisitos: Python 3.12, Node 24, FFmpeg en `PATH`, GPU NVIDIA opcional.

```powershell
python -m venv .venv
.venv\Scripts\pip install torch --index-url https://download.pytorch.org/whl/cu128   # o /whl/cpu
.venv\Scripts\pip install -e .\ml -e .\apps\worker -r apps\api\requirements.txt
.venv\Scripts\python scripts\download_model.py        # checkpoint ~165 MB
npm install
```

Modo local (sin login, biblioteca en esta PC):

```powershell
.venv\Scripts\python -m uvicorn app.main:app --app-dir apps\api --port 8010
npm run dev:web        # http://localhost:3000
```

Modo nube en local (misma app que producción, contra el Supabase real):

```powershell
# apps/web/.env.local con NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY
cd apps/web && npx next dev --port 3000
```

CLI de transcripción: `.venv\Scripts\python scripts\transcribe.py data\input\cancion.mp3`
(opciones `--device`, `--no-midi`, `--no-hands`). Benchmark: `scripts\benchmark.py`.

## Tests y verificación

```powershell
.venv\Scripts\python -m pytest ml\tests apps\worker\tests -q   # 120 tests (el test en vivo se salta salvo PIANO_RUN_LIVE_TESTS=1)
npx vitest run --root apps\web                                   # 175 tests
npx tsc --noEmit -p apps\web
cd apps\web && npx next build                                    # no con `next dev` abierto (comparten .next/)
```

## Operación

- Despliegue web: `git push` a `main` (Vercel auto-deploy, raíz `apps/web`). No usar
  `vercel deploy` desde la PC (subiría el checkpoint).
- Worker Modal: `modal deploy --env production-canary benchmarks/modal/controlled_migration/production_canary_worker.py`
  (con `PYTHONIOENCODING=utf-8` en Windows).
- Migraciones: `migrations/supabase/NNNN_*.sql` con su `.down.sql`; se aplican con la
  conexión `PRODUCTION_PREFLIGHT_DATABASE_URL` (solo en `.env.local`).
- Runbooks: [`docs/deploy.md`](docs/deploy.md) (operación diaria),
  [`docs/MODAL_GENERAL_PROCESSING.md`](docs/MODAL_GENERAL_PROCESSING.md) (cola y wake),
  [`docs/AUTH_EMAIL_RESEND.md`](docs/AUTH_EMAIL_RESEND.md) (correo de producción).
