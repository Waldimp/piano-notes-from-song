/**
 * Dibujo del tutorial en Canvas 2D — "acuarela": teclado de marfil sobre
 * crema, notas como barras pastel (matcha y chai). Sin estado propio de tiempo: recibe
 * `currentTime` (derivado de audio.currentTime, el reloj autoritativo) y
 * pinta un frame completo. Toda la geometría/matemática vive en falling.ts y
 * keyboard.ts; aquí solo hay presentación.
 */

import type { PianoNote } from "@piano/contracts";
import { noteBar, visibleRange, visualEnd } from "./falling";
import { isBlackKey, keyGeometry, noteName } from "./keyboard";

export const KEYBOARD_HEIGHT_RATIO = 0.17;
export const PIXELS_PER_SECOND = 170;

const STAGE = {
  bgTop: "#f7f3ea",
  bgBottom: "#ece5d6",
  lane: "rgba(114, 92, 58, 0.06)",
  laneC: "rgba(114, 92, 58, 0.13)",
  felt: "#b3b792",
  feltGlow: "rgba(128, 150, 113, 0.45)",
  whiteKeyTop: "#fffdf8",
  whiteKeyBottom: "#f1eadc",
  whiteKeyEdge: "#d6cbb6",
  blackKeyTop: "#8b7554",
  blackKeyBottom: "#5c4a2c",
  keyGap: "#d8cdb9",
  labelOnWhite: "#8a7a62",
  labelOnBlack: "#f3ebdd",
  labelOnBar: "rgba(58, 46, 28, 0.85)",
  loopBand: "rgba(210, 171, 128, 0.18)",
  loopEdge: "rgba(114, 92, 58, 0.5)",
};

/**
 * Colores por mano, en la paleta suave de Pianissimo: derecha (o sin mano)
 * en matcha, izquierda en chai. Ambas se distinguen al instante y conviven
 * con el fondo crema sin estridencias.
 */
const HAND_COLORS = {
  right: {
    onWhite: "#809671",
    onBlack: "#66795a",
    glow: "rgba(128, 150, 113, 0.32)",
    keyWhite: "#b3b792",
    keyBlack: "#6f8563",
  },
  left: {
    onWhite: "#d2ab80",
    onBlack: "#b8905f",
    glow: "rgba(210, 171, 128, 0.34)",
    keyWhite: "#e5d2b8",
    keyBlack: "#c39a6a",
  },
};

export type HandFilter = "both" | "left" | "right";

function handOf(note: PianoNote): "left" | "right" {
  return note.hand === "left" ? "left" : "right";
}

function noteAlpha(note: PianoNote, filter: HandFilter): number {
  if (filter === "both") return 1;
  return handOf(note) === filter ? 1 : 0.14;
}

/** Opciones de visualización del usuario (persisten en el navegador). */
export interface ViewOptions {
  /** Duración máxima mostrada por nota, en segundos; null = real. */
  noteDurationCap: number | null;
  /** Nombres de las notas (C, D#, …) en teclas y barras. */
  showNoteNames: boolean;
  /** Halo de luz alrededor de las barras (barato: sin shadowBlur). */
  glow?: boolean;
}

export const DEFAULT_VIEW_OPTIONS: ViewOptions = { noteDurationCap: 1.5, showNoteNames: true, glow: true };

export interface FrameState {
  notes: PianoNote[];
  /** Duración máxima de nota, precalculada una vez por canción. */
  maxNoteDuration: number;
  currentTime: number;
  loopA: number | null;
  loopB: number | null;
  handFilter: HandFilter;
  view: ViewOptions;
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: FrameState,
): void {
  const keyboardHeight = Math.max(56, height * KEYBOARD_HEIGHT_RATIO);
  const keyboardY = height - keyboardHeight;
  const { notes, currentTime } = state;

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, STAGE.bgTop);
  bg.addColorStop(1, STAGE.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Una sola ventana binaria por frame: sirve para las barras visibles y
  // para las teclas activas (toda nota sonando cumple end > t y start <= t).
  const lookahead = keyboardY / PIXELS_PER_SECOND;
  const range = visibleRange(notes, currentTime, lookahead, state.maxNoteDuration);

  drawLaneGuides(ctx, width, keyboardY);
  drawLoopBand(ctx, width, keyboardY, state);
  drawFallingNotes(ctx, width, keyboardY, state, range);
  drawKeyboard(ctx, width, keyboardY, keyboardHeight, state, range);
}

/** Líneas verticales sutiles por octava (las C algo más visibles). */
function drawLaneGuides(ctx: CanvasRenderingContext2D, width: number, keyboardY: number): void {
  ctx.lineWidth = 1;
  for (let pitch = 24; pitch <= 108; pitch += 12) {
    const g = keyGeometry(pitch, width);
    ctx.strokeStyle = STAGE.laneC;
    ctx.beginPath();
    ctx.moveTo(Math.round(g.x) + 0.5, 0);
    ctx.lineTo(Math.round(g.x) + 0.5, keyboardY);
    ctx.stroke();
    if (pitch + 5 > 108) continue; // el piano termina en C8
    const f = keyGeometry(pitch + 5, width); // F: guía secundaria
    ctx.strokeStyle = STAGE.lane;
    ctx.beginPath();
    ctx.moveTo(Math.round(f.x) + 0.5, 0);
    ctx.lineTo(Math.round(f.x) + 0.5, keyboardY);
    ctx.stroke();
  }
}

/** Banda translúcida del loop A/B proyectada en el tiempo (y = keyboardY + (t - time)·pps). */
function drawLoopBand(ctx: CanvasRenderingContext2D, width: number, keyboardY: number, state: FrameState): void {
  const { loopA, loopB, currentTime } = state;
  if (loopA === null || loopB === null || loopB <= loopA) return;
  const yA = keyboardY + (currentTime - loopA) * PIXELS_PER_SECOND; // más abajo (antes)
  const yB = keyboardY + (currentTime - loopB) * PIXELS_PER_SECOND; // más arriba (después)
  const top = Math.max(0, Math.min(yA, yB));
  const bottom = Math.min(keyboardY, Math.max(yA, yB));
  if (bottom <= top) return;
  ctx.fillStyle = STAGE.loopBand;
  ctx.fillRect(0, top, width, bottom - top);
  ctx.strokeStyle = STAGE.loopEdge;
  ctx.lineWidth = 1;
  for (const y of [yA, yB]) {
    if (y < 0 || y > keyboardY) continue;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawFallingNotes(
  ctx: CanvasRenderingContext2D,
  width: number,
  keyboardY: number,
  state: FrameState,
  { lo, hi }: { lo: number; hi: number },
): void {
  const { notes, currentTime, view } = state;
  const whiteWidth = width / 52;
  const labelFont = Math.max(8, Math.min(13, whiteWidth * 0.62));
  const glow = view.glow !== false;
  ctx.font = `600 ${labelFont}px var(--font-body, system-ui), system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";

  for (let i = lo; i < hi; i++) {
    const note = notes[i];
    const end = visualEnd(note, view.noteDurationCap);
    if (end <= currentTime) continue;

    const bar = noteBar({ start: note.start, end }, currentTime, keyboardY, PIXELS_PER_SECOND);
    const top = Math.max(0, bar.topY);
    const bottom = Math.min(keyboardY, bar.bottomY);
    if (bottom <= top) continue;

    const g = keyGeometry(note.pitch, width);
    const black = isBlackKey(note.pitch);
    const barWidth = black ? g.width : g.width * 0.84;
    const x = g.x + (g.width - barWidth) / 2;
    const palette = HAND_COLORS[handOf(note)];
    const alpha = noteAlpha(note, state.handFilter);
    const h = bottom - top;
    const radius = Math.min(5, barWidth / 2, h / 2);
    const sounding = note.start <= currentTime;

    ctx.globalAlpha = alpha;
    if (glow && sounding) {
      // Halo barato: rectángulo mayor translúcido bajo la barra que está sonando.
      ctx.fillStyle = palette.glow;
      ctx.beginPath();
      ctx.roundRect(x - barWidth * 0.55, top - 4, barWidth * 2.1, h + 10, radius + 4);
      ctx.fill();
    }
    const grad = ctx.createLinearGradient(0, top, 0, bottom);
    grad.addColorStop(0, black ? palette.onBlack : palette.onWhite);
    grad.addColorStop(1, black ? palette.onBlack : palette.onWhite);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, top, barWidth, h, radius);
    ctx.fill();
    // Brillo superior (sensación de volumen) — solo una línea.
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(x + 1, top + 1, Math.max(0, barWidth - 2), 1);

    if (view.showNoteNames && h >= labelFont + 4 && barWidth >= labelFont * 0.8) {
      ctx.fillStyle = STAGE.labelOnBar;
      ctx.fillText(noteName(note.pitch), x + barWidth / 2, bottom - 3, barWidth);
    }
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
  const { notes, currentTime, handFilter, view } = state;
  const active = new Map<number, "left" | "right">();
  for (let i = lo; i < hi; i++) {
    const n = notes[i];
    if (n.start > currentTime || currentTime >= visualEnd(n, view.noteDurationCap)) continue;
    if (handFilter !== "both" && handOf(n) !== handFilter) continue;
    active.set(n.pitch, handOf(n));
  }

  // Fieltro (línea de impacto) con leve resplandor
  ctx.fillStyle = STAGE.feltGlow;
  ctx.fillRect(0, keyboardY - 5, width, 5);
  ctx.fillStyle = STAGE.felt;
  ctx.fillRect(0, keyboardY - 2, width, 2);

  // Blancas
  const whiteGrad = ctx.createLinearGradient(0, keyboardY, 0, keyboardY + keyboardHeight);
  whiteGrad.addColorStop(0, STAGE.whiteKeyTop);
  whiteGrad.addColorStop(1, STAGE.whiteKeyBottom);
  for (let pitch = 21; pitch <= 108; pitch++) {
    if (isBlackKey(pitch)) continue;
    const g = keyGeometry(pitch, width);
    const hand = active.get(pitch);
    ctx.fillStyle = hand ? HAND_COLORS[hand].keyWhite : whiteGrad;
    ctx.fillRect(g.x, keyboardY, g.width, keyboardHeight);
    // borde inferior (grosor de la tecla) y separación
    ctx.fillStyle = STAGE.whiteKeyEdge;
    ctx.fillRect(g.x, keyboardY + keyboardHeight - 3, g.width, 3);
    ctx.fillStyle = STAGE.keyGap;
    ctx.fillRect(g.x + g.width - 1, keyboardY, 1, keyboardHeight);
  }
  // Negras
  const blackHeight = keyboardHeight * 0.6;
  for (let pitch = 21; pitch <= 108; pitch++) {
    if (!isBlackKey(pitch)) continue;
    const g = keyGeometry(pitch, width);
    const hand = active.get(pitch);
    if (hand) {
      ctx.fillStyle = HAND_COLORS[hand].keyBlack;
    } else {
      const bg = ctx.createLinearGradient(0, keyboardY, 0, keyboardY + blackHeight);
      bg.addColorStop(0, STAGE.blackKeyTop);
      bg.addColorStop(1, STAGE.blackKeyBottom);
      ctx.fillStyle = bg;
    }
    ctx.beginPath();
    ctx.roundRect(g.x, keyboardY, g.width, blackHeight, [0, 0, 3, 3]);
    ctx.fill();
  }

  if (!view.showNoteNames) return;

  const whiteWidth = width / 52;
  const whiteFont = Math.max(8, Math.min(12, whiteWidth * 0.58));
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = STAGE.labelOnWhite;
  ctx.font = `600 ${whiteFont}px var(--font-body, system-ui), system-ui, sans-serif`;
  for (let pitch = 21; pitch <= 108; pitch++) {
    if (isBlackKey(pitch)) continue;
    const g = keyGeometry(pitch, width);
    const isC = pitch % 12 === 0;
    ctx.fillText(noteName(pitch, isC && whiteWidth >= 18), g.x + g.width / 2, keyboardY + keyboardHeight - 6, g.width - 2);
  }
  if (whiteWidth >= 14) {
    const blackFont = Math.max(7, Math.min(10, whiteWidth * 0.42));
    ctx.fillStyle = STAGE.labelOnBlack;
    ctx.font = `600 ${blackFont}px var(--font-body, system-ui), system-ui, sans-serif`;
    for (let pitch = 21; pitch <= 108; pitch++) {
      if (!isBlackKey(pitch)) continue;
      const g = keyGeometry(pitch, width);
      ctx.fillText(noteName(pitch), g.x + g.width / 2, keyboardY + blackHeight - 3, g.width);
    }
  }
}
