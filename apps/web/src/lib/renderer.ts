/**
 * Dibujo del tutorial en Canvas 2D. Sin estado propio de tiempo: recibe
 * `currentTime` (siempre derivado de audio.currentTime, el reloj autoritativo)
 * y pinta un frame completo.
 */

import type { PianoNote } from "@piano/contracts";
import { isSounding, noteBar, visibleRange } from "./falling";
import { isBlackKey, keyGeometry } from "./keyboard";

export const KEYBOARD_HEIGHT_RATIO = 0.16;
export const PIXELS_PER_SECOND = 170;

const COLORS = {
  background: "#14141c",
  laneLine: "#23232e",
  whiteKey: "#f5f2ea",
  whiteKeyActive: "#7dd487",
  blackKey: "#1f1f26",
  blackKeyActive: "#4caf60",
  keyBorder: "#0a0a0e",
  keyboardLine: "#e05b4b",
  noteOnWhite: "#63c96f",
  noteOnBlack: "#2f9e4f",
  noteBorder: "rgba(0,0,0,0.35)",
  loopShade: "rgba(224, 91, 75, 0.10)",
};

export interface FrameState {
  notes: PianoNote[];
  /** Duración máxima de nota, precalculada una vez por canción. */
  maxNoteDuration: number;
  currentTime: number;
  loopA: number | null;
  loopB: number | null;
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: FrameState,
): void {
  const keyboardHeight = Math.max(60, height * KEYBOARD_HEIGHT_RATIO);
  const keyboardY = height - keyboardHeight;
  const { notes, currentTime } = state;

  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);

  // Una sola ventana binaria por frame: sirve para las barras visibles y
  // para las teclas activas (toda nota sonando cumple end > t y start <= t).
  const lookahead = keyboardY / PIXELS_PER_SECOND;
  const range = visibleRange(notes, currentTime, lookahead, state.maxNoteDuration);

  drawLaneGuides(ctx, width, keyboardY);
  drawFallingNotes(ctx, width, keyboardY, state, range);
  drawKeyboard(ctx, width, keyboardY, keyboardHeight, state, range);
}

/** Líneas verticales sutiles en cada C para orientarse. */
function drawLaneGuides(
  ctx: CanvasRenderingContext2D,
  width: number,
  keyboardY: number,
): void {
  ctx.strokeStyle = COLORS.laneLine;
  ctx.lineWidth = 1;
  for (let pitch = 24; pitch <= 108; pitch += 12) {
    const g = keyGeometry(pitch, width);
    ctx.beginPath();
    ctx.moveTo(g.x, 0);
    ctx.lineTo(g.x, keyboardY);
    ctx.stroke();
  }
}

function drawFallingNotes(
  ctx: CanvasRenderingContext2D,
  width: number,
  keyboardY: number,
  state: FrameState,
  { lo, hi }: { lo: number; hi: number },
): void {
  const { notes, currentTime } = state;

  for (let i = lo; i < hi; i++) {
    const note = notes[i];
    if (note.end <= currentTime) continue; // ya cayó por completo

    const bar = noteBar(note, currentTime, keyboardY, PIXELS_PER_SECOND);
    const top = Math.max(0, bar.topY);
    const bottom = Math.min(keyboardY, bar.bottomY);
    if (bottom <= top) continue;

    const g = keyGeometry(note.pitch, width);
    const black = isBlackKey(note.pitch);
    // Las notas de teclas negras se dibujan un poco más angostas y oscuras
    // para que el ojo las conecte con su tecla.
    const barWidth = black ? g.width : g.width * 0.86;
    const x = g.x + (g.width - barWidth) / 2;

    ctx.fillStyle = black ? COLORS.noteOnBlack : COLORS.noteOnWhite;
    ctx.strokeStyle = COLORS.noteBorder;
    ctx.beginPath();
    const radius = Math.min(4, barWidth / 2, (bottom - top) / 2);
    ctx.roundRect(x, top, barWidth, bottom - top, radius);
    ctx.fill();
    ctx.stroke();
  }
}

function drawKeyboard(
  ctx: CanvasRenderingContext2D,
  width: number,
  keyboardY: number,
  keyboardHeight: number,
  state: FrameState,
  { lo, hi }: { lo: number; hi: number },
): void {
  const { notes, currentTime } = state;
  // Teclas que están sonando ahora mismo (para iluminarlas).
  const active = new Set<number>();
  for (let i = lo; i < hi; i++) {
    if (isSounding(notes[i], currentTime)) active.add(notes[i].pitch);
  }

  // Línea de impacto
  ctx.fillStyle = COLORS.keyboardLine;
  ctx.fillRect(0, keyboardY - 2, width, 2);

  // Blancas primero, negras encima
  for (let pitch = 21; pitch <= 108; pitch++) {
    if (isBlackKey(pitch)) continue;
    const g = keyGeometry(pitch, width);
    ctx.fillStyle = active.has(pitch) ? COLORS.whiteKeyActive : COLORS.whiteKey;
    ctx.fillRect(g.x, keyboardY, g.width, keyboardHeight);
    ctx.strokeStyle = COLORS.keyBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(g.x, keyboardY, g.width, keyboardHeight);
  }
  for (let pitch = 21; pitch <= 108; pitch++) {
    if (!isBlackKey(pitch)) continue;
    const g = keyGeometry(pitch, width);
    ctx.fillStyle = active.has(pitch) ? COLORS.blackKeyActive : COLORS.blackKey;
    ctx.fillRect(g.x, keyboardY, g.width, keyboardHeight * 0.62);
  }
}
