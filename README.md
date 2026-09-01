# Piano Tutorial (local-first)

Aplicación privada de tutoriales de piano: convierte audio de piano en un
tutorial interactivo de notas que caen (estilo Synthesia), ejecutándose
completamente en la máquina local.

```text
audio de piano
  → transcripción automática (High-Resolution Piano Transcription)
  → notes.json normalizado (+ MIDI opcional)
  → tutorial en el navegador (teclado de 88 teclas, notas que caen,
    velocidad 0.5x/0.75x/1x, loop A/B)
```

El contrato técnico completo está en `piano_tutorial_project_contract.md`.
Las decisiones importantes se documentan en `docs/decisions/`.

## Estructura del monorepo

```text
apps/
  web/        Frontend Next.js + TypeScript + Canvas 2D (Fase 2)
  api/        Backend FastAPI (delgado; delega en piano_ml)
packages/
  contracts/  Tipos TypeScript del contrato PianoTranscription v1
ml/           Paquete Python "piano_ml": engines, preprocesamiento,
              normalización, contratos Pydantic. Tests en ml/tests/.
  checkpoints/  Checkpoint del modelo (git-ignorado, ~165 MB)
data/
  input/      Audios a transcribir (git-ignorado)
  output/     Transcripciones generadas (git-ignorado)
  samples/    Audios de muestra pequeños
migrations/   Reservado para futuras migraciones de BD (vacío a propósito)
docs/         Decisiones (ADRs) y arquitectura
scripts/      CLI de transcripción y descarga del modelo
```

## Prerrequisitos

| Herramienta | Versión verificada | Notas |
|---|---|---|
| Python | 3.12.10 | |
| Node.js | 24.x | npm 11 |
| FFmpeg | 8.1.2 | debe estar en el `PATH` (o define `FFMPEG_BIN`) |
| GPU NVIDIA | opcional | acelera la transcripción; con `PIANO_DEVICE=auto` se usa si existe |

### Instalar FFmpeg (Windows)

```powershell
winget install Gyan.FFmpeg
# o descarga el build "full" de https://www.gyan.dev/ffmpeg/builds/ y añade bin/ al PATH
ffmpeg -version   # verificar
```

## Instalación

Desde la raíz del repo:

```powershell
# 1. Entorno Python
python -m venv .venv
.venv\Scripts\python -m pip install --upgrade pip

# 2. PyTorch — con GPU NVIDIA (CUDA 12.8):
.venv\Scripts\pip install torch --index-url https://download.pytorch.org/whl/cu128
#    …o solo CPU:
# .venv\Scripts\pip install torch --index-url https://download.pytorch.org/whl/cpu

# 3. Paquete ML (editable) + backend
.venv\Scripts\pip install -e .\ml
.venv\Scripts\pip install -r apps\api\requirements.txt

# 4. Checkpoint del modelo (~165 MB, una sola vez)
.venv\Scripts\python scripts\download_model.py

# 5. Frontend
npm install
```

## Transcribir un archivo (Fase 1)

```powershell
.venv\Scripts\python scripts\transcribe.py data\samples\cut_liszt.mp3
```

Salida en `data/output/cut_liszt/`:

```text
notes.json          contrato normalizado v1 (lo que consume el frontend)
transcription.mid   MIDI para escucha/depuración
source.mp3          copia del audio original (para el tutorial)
```

Opciones: `--device cpu|cuda|auto`, `--no-midi`, `--checkpoint <ruta>`, `--output <dir>`.

## Ejecutar el backend

```powershell
.venv\Scripts\python -m uvicorn app.main:app --app-dir apps\api --port 8010
```

- `GET  /health` — estado y dispositivo en uso
- `POST /api/transcribe` — multipart upload, transcripción síncrona
- `GET  /api/transcriptions` — lista transcripciones generadas
- `GET  /api/transcriptions/{id}/notes|midi|audio`

## Ejecutar el frontend

```powershell
npm run dev:web
```

Abre <http://localhost:3000>, elige una transcripción y se carga el tutorial.

## Tests

```powershell
.venv\Scripts\python -m pytest ml\tests -q     # contrato + normalización
npm run test:web                                # lógica del renderer (Fase 2)
```

## Versiones verificadas

El entorno reproducible completo está en `requirements.lock.txt` (`pip freeze`).
Claves: `torch==2.11.0+cu128`, `piano_transcription_inference==0.0.6`,
`librosa==1.0.0`, `pydantic==2.13.5`, `fastapi==0.116.1`. Rendimiento medido
(RTX PRO 2000, 8 GB): 40 s de audio → 510 notas en ~8 s de inferencia
(+ ~6 s de carga del modelo, una vez por proceso).

## Variables de entorno

Copia `.env.example` a `.env` si necesitas cambiar defaults
(checkpoint, dispositivo, FFmpeg, puertos). Todo funciona sin `.env`.
