# 0001 — Engine primario: High-Resolution Piano Transcription

**Estado:** aceptado (2026-08-31)

## Decisión

El engine AMT primario es **High-Resolution Piano Transcription** (Kong et al.,
ByteDance), consumido a través del paquete `piano_transcription_inference==0.0.6`
con el checkpoint oficial de Zenodo (record 4034264, ~165 MB).

## Razones

- Especializado en piano (pitch/onset/offset/velocity + pedal).
- Checkpoint público y estable; inferencia reproducible en local.
- Mejor punto de partida que un modelo multi-instrumento genérico.

## Aislamiento

El paquete queda envuelto en `ml/piano_ml/engines/high_resolution.py` detrás de
la abstracción `TranscriptionEngine`. El frontend y el API solo conocen el
contrato normalizado (`PianoTranscription` v1). **Spotify Basic Pitch** es el
fallback previsto: se integraría como otro `TranscriptionEngine` sin tocar el
frontend. No se sustituye el engine sin comparar resultados reales (contrato §7).
