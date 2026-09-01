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
  blackKey: "#1f1f26",
  keyBorder: "#0a0a0e",
  keyboardLine: "#e05b4b",
  noteBorder: "rgba(0,0,0,0.35)",
};

/** Colores por mano: derecha/sin mano en verde, izquierda en azul. */
const HAND_COLORS = {
  right: { onWhite: "#63c96f", onBlack: "#2f9e4f", keyWhite: "#7dd487", keyBlack: "#4caf60" },
  left: { onWhite: "#5fa8dc", onBlack: "#3178ac", keyWhite: "#7cbde8", keyBlack: "#4a90c4" },
};

export type HandFilter = "both" | "left" | "right";

function handOf(note: PianoNote): "left" | "right" {
  return note.hand === "left" ? "left" : "right";
}

/** Opacidad de una nota segun el filtro de mano activo. */
function noteAlpha(note: PianoNote, filter: HandFilter): number {
  if (filter === "both") return 1;
  return handOf(note) === filter ? 1 : 0.16;
}

export interface FrameState {
  notes: PianoNote[];
  /** Duración máxima de nota, precalculada una vez por canción. */
  maxNoteDuration: number;
  currentTime: number;
  loopA: number | null;
  loopB: number | null;
  handFilter: HandFilter;
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
    const palette = HAND_COLORS[handOf(note)];

    ctx.globalAlpha = noteAlpha(note, state.handFilter);
    ctx.fillStyle = black ? palette.onBlack : palette.onWhite;
    ctx.strokeStyle = COLORS.noteBorder;
    ctx.beginPath();
    const radius = Math.min(4, barWidth / 2, (bottom - top) / 2);
    ctx.roundRect(x, top, barWidth, bottom - top, radius);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
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
  const { notes, currentTime, handFilter } = state;
  // Teclas que están sonando ahora mismo, con la mano que las toca.
  const active = new Map<number, "left" | "right">();
  for (let i = lo; i < hi; i++) {
    const n = notes[i];
    if (!isSounding(n, currentTime)) continue;
    if (handFilter !== "both" && handOf(n) !== handFilter) continue;
    active.set(n.pitch, handOf(n));
  }

  // Línea de impacto
  ctx.fillStyle = COLORS.keyboardLine;
  ctx.fillRect(0, keyboardY - 2, width, 2);

  // Blancas primero, negras encima
  for (let pitch = 21; pitch <= 108; pitch++) {
    if (isBlackKey(pitch)) continue;
    const g = keyGeometry(pitch, width);
    const hand = active.get(pitch);
    ctx.fillStyle = hand ? HAND_COLORS[hand].keyWhite : COLORS.whiteKey;
    ctx.fillRect(g.x, keyboardY, g.width, keyboardHeight);
    ctx.strokeStyle = COLORS.keyBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(g.x, keyboardY, g.width, keyboardHeight);
  }
  for (let pitch = 21; pitch <= 108; pitch++) {
    if (!isBlackKey(pitch)) continue;
    const g = keyGeometry(pitch, width);
    const hand = active.get(pitch);
    ctx.fillStyle = hand ? HAND_COLORS[hand].keyBlack : COLORS.blackKey;
    ctx.fillRect(g.x, keyboardY, g.width, keyboardHeight * 0.62);
  }
}
