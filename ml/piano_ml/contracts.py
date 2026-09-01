"""Contrato normalizado de transcripcion — version 1.

Espejo logico de packages/contracts/src/index.ts. Cualquier cambio de esquema
debe hacerse en ambos lados y de forma versionada.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Rango de un piano de 88 teclas: A0 (21) .. C8 (108).
MIN_PIANO_PITCH = 21
MAX_PIANO_PITCH = 108

Hand = Optional[Literal["left", "right"]]


class PianoNote(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pitch: int = Field(ge=MIN_PIANO_PITCH, le=MAX_PIANO_PITCH)
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    velocity: int = Field(ge=0, le=127)
    hand: Hand = None

    @model_validator(mode="after")
    def _end_after_start(self) -> "PianoNote":
        if self.end <= self.start:
            raise ValueError(
                f"end ({self.end}) debe ser mayor que start ({self.start})"
            )
        return self


class PedalEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: float = Field(ge=0)
    end: float = Field(gt=0)

    @model_validator(mode="after")
    def _end_after_start(self) -> "PedalEvent":
        if self.end <= self.start:
            raise ValueError(
                f"end ({self.end}) debe ser mayor que start ({self.start})"
            )
        return self


class SourceInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str


class TranscriptionInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    engine: str


class PianoTranscription(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[1] = 1
    duration: float = Field(gt=0)
    source: SourceInfo
    transcription: TranscriptionInfo
    notes: list[PianoNote]
    pedals: list[PedalEvent]
