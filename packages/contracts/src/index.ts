/**
 * Contrato normalizado de transcripción de piano — versión 1.
 *
 * Este es el contrato compartido entre el backend Python (ml/piano_ml/contracts.py)
 * y el frontend. Ambos lados deben validar la misma forma lógica.
 * Cualquier cambio de esquema debe ser deliberado y versionado.
 */

export type Hand = "left" | "right" | null;

/** Rango de un piano de 88 teclas: A0 (21) .. C8 (108). */
export const MIN_PIANO_PITCH = 21;
export const MAX_PIANO_PITCH = 108;

export interface PianoNote {
  /** Nota MIDI, 21..108 (piano de 88 teclas). */
  pitch: number;
  /** Segundos desde el inicio del audio. >= 0. */
  start: number;
  /** Segundos desde el inicio del audio. > start. */
  end: number;
  /** Velocidad MIDI, 0..127. */
  velocity: number;
  /** Mano asignada. null hasta que exista post-procesamiento de manos. */
  hand: Hand;
}

export interface PedalEvent {
  /** Segundos. >= 0. */
  start: number;
  /** Segundos. > start. */
  end: number;
}

export interface PianoTranscription {
  version: 1;
  /** Duración del audio original, en segundos. */
  duration: number;
  source: {
    filename: string;
  };
  transcription: {
    /** Identificador del engine, p. ej. "high-resolution-piano-transcription". */
    engine: string;
  };
  notes: PianoNote[];
  pedals: PedalEvent[];
}

/** Type guard ligero para validar un JSON cargado en el navegador. */
export function isPianoTranscription(value: unknown): value is PianoTranscription {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.duration === "number" &&
    Array.isArray(v.notes) &&
    Array.isArray(v.pedals)
  );
}
