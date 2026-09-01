"""piano_ml: transcripcion de piano local-first.

Modulos principales:
- contracts: modelos Pydantic del contrato normalizado (espejo de packages/contracts).
- normalize: eventos crudos del modelo -> PianoTranscription validada.
- preprocessing.audio: decodificacion via FFmpeg a 16 kHz mono.
- engines: abstraccion TranscriptionEngine + implementacion High-Resolution.
"""

__version__ = "0.1.0"
