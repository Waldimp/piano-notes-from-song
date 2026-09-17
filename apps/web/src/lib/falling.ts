/**
 * Cálculo de posiciones de notas que caen — lógica pura, sin canvas.
 *
 * Convención (contrato técnico §8):
 *   la parte INFERIOR de la barra toca la línea del teclado exactamente
 *   cuando currentTime === note.start. La barra mide (end-start)*pps px.
 *
 *   bottomY = keyboardY + (t - note.start) * pps
 *   topY    = bottomY - (note.end - note.start) * pps
 */

import type { PianoNote } from "@piano/contracts";

export interface NoteBar {
  /** Borde superior de la barra (px, y crece hacia abajo). */
  topY: number;
  /** Borde inferior de la barra. */
  bottomY: number;
}

export function noteBar(
  note: Pick<PianoNote, "start" | "end">,
  currentTime: number,
  keyboardY: number,
  pixelsPerSecond: number,
): NoteBar {
  const bottomY = keyboardY + (currentTime - note.start) * pixelsPerSecond;
  const topY = bottomY - (note.end - note.start) * pixelsPerSecond;
  return { topY, bottomY };
}

/**
 * Fin visual de una nota: el modelo alarga las notas hasta que el sonido se
 * apaga (con pedal, varios segundos), y eso acumula barras y confunde.
 * `cap` (segundos) recorta la duración mostrada; null = duración real.
 */
export function visualEnd(note: Pick<PianoNote, "start" | "end">, cap: number | null): number {
  if (cap === null) return note.end;
  return Math.min(note.end, note.start + cap);
}

/** ¿La nota está sonando en el instante t? (para iluminar la tecla) */
export function isSounding(
  note: Pick<PianoNote, "start" | "end">,
  currentTime: number,
): boolean {
  return note.start <= currentTime && currentTime < note.end;
}

/**
 * Rango [lo, hi) de índices potencialmente visibles en una lista de notas
 * ordenada por `start` (garantizado por la normalización del backend).
 *
 * Visible ⟺ end > t (aún no cayó del todo) ∧ start < t + lookahead (ya entró
 * por arriba), con lookahead = keyboardY / pps segundos.
 *
 * Para no escanear toda la canción cada frame (contrato §18), se acota con
 * búsqueda binaria sobre `start`:
 *   hi: primera nota con start >= t + lookahead.
 *   lo: primera nota con start >= t - maxDuration (ninguna nota anterior
 *       puede seguir visible, porque end <= start + maxDuration <= t).
 * Dentro del rango puede haber notas ya invisibles: el llamador filtra con
 * `end > t` (o simplemente las dibuja recortadas, que es equivalente).
 */
export function visibleRange(
  notes: ReadonlyArray<Pick<PianoNote, "start" | "end">>,
  currentTime: number,
  lookaheadSeconds: number,
  maxNoteDuration: number,
): { lo: number; hi: number } {
  const hi = lowerBoundByStart(notes, currentTime + lookaheadSeconds);
  const lo = lowerBoundByStart(notes, currentTime - maxNoteDuration);
  return { lo, hi };
}

/** Primera posición cuyo start >= target (búsqueda binaria). */
export function lowerBoundByStart(
  notes: ReadonlyArray<Pick<PianoNote, "start">>,
  target: number,
): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].start < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function maxDuration(
  notes: ReadonlyArray<Pick<PianoNote, "start" | "end">>,
): number {
  let max = 0;
  for (const n of notes) max = Math.max(max, n.end - n.start);
  return max;
}
