# 0002 — Compatibilidad: Python 3.12 + torch moderno + Windows

**Estado:** aceptado (2026-08-31)

## Contexto

`piano_transcription_inference` 0.0.6 (2020) tiene tres incompatibilidades con
el entorno actual (Python 3.12.10, torch >= 2.6, Windows 11). Se resolvieron
sin modificar el código del paquete:

## Decisiones

1. **Checkpoint gestionado por nosotros.** La auto-descarga del paquete usa
   `wget` vía `os.system` (inexistente en Windows). `scripts/download_model.py`
   descarga el checkpoint a `ml/checkpoints/` y el engine siempre recibe
   `checkpoint_path` explícito. Un checkpoint ausente es un error claro, no una
   descarga silenciosa fallida.

2. **Shim de `torch.load`.** torch >= 2.6 usa `weights_only=True` por defecto y
   rechaza este checkpoint de 2020. `HighResolutionEngine` carga el modelo
   dentro de un context manager que restablece `weights_only=False` únicamente
   durante esa carga. Aceptable porque el checkpoint proviene de una fuente
   fija y conocida (Zenodo). Tradeoff: si se cambia la URL del checkpoint, debe
   revisarse esta decisión.

3. **Decodificación de audio por FFmpeg, no librosa/audioread.** Un único
   camino de decodificación explícito (`ml/piano_ml/preprocessing/audio.py`,
   FFmpeg → PCM f32 mono 16 kHz por stdout). `audioread` se instala igualmente
   porque el paquete lo importa a nivel de módulo (en librosa >= 0.11 es
   opcional y dejaría de venir por defecto).

4. **torch con CUDA 12.8.** La máquina de desarrollo tiene una NVIDIA RTX PRO
   2000 (8 GB). Se instala el wheel cu128; el dispositivo se resuelve en
   runtime (`PIANO_DEVICE=auto` → cuda si está disponible, cpu si no), así que
   el código sigue siendo portable a máquinas sin GPU.

Las versiones exactas verificadas están en `requirements.txt` y el README.
