/**
 * Geometría del teclado de 88 teclas (A0 = MIDI 21 … C8 = MIDI 108).
 *
 * Lógica pura y testeable: mapea pitch MIDI a posición/tamaño de tecla en un
 * ancho de lienzo dado. Las negras se centran en la frontera entre sus dos
 * blancas vecinas (suficiente para el prototipo; el offset asimétrico de un
 * piano real es un refinamiento posterior).
 */

import { MAX_PIANO_PITCH, MIN_PIANO_PITCH } from "@piano/contracts";

export const WHITE_KEY_COUNT = 52;

/** Clases de semitono relativas a A (A0 = 0): A# C# D# F# G# son negras. */
const BLACK_CLASSES = new Set([1, 4, 6, 9, 11]);

/** Blancas acumuladas ANTES de cada clase de semitono relativa a A. */
const WHITE_BEFORE = [0, 1, 1, 2, 3, 3, 4, 4, 5, 6, 6, 7];

/** Nombres por clase de altura (C = 0), notación anglosajona con sostenidos. */
export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

/** "C#" para 61; con octava: "C#4" (C4 = 60, convención MIDI). */
export function noteName(pitch: number, withOctave = false): string {
  const name = NOTE_NAMES[((pitch % 12) + 12) % 12];
  return withOctave ? `${name}${Math.floor(pitch / 12) - 1}` : name;
}

export function isValidPianoPitch(pitch: number): boolean {
  return Number.isInteger(pitch) && pitch >= MIN_PIANO_PITCH && pitch <= MAX_PIANO_PITCH;
}

export function isBlackKey(pitch: number): boolean {
  return BLACK_CLASSES.has((pitch - MIN_PIANO_PITCH) % 12);
}

/** Índice 0..51 de la tecla blanca correspondiente a un pitch blanco. */
export function whiteKeyIndex(pitch: number): number {
  const offset = pitch - MIN_PIANO_PITCH;
  const octaves = Math.floor(offset / 12);
  return octaves * 7 + WHITE_BEFORE[offset % 12];
}

export interface KeyGeometry {
  x: number;
  width: number;
  isBlack: boolean;
}

/**
 * Posición horizontal de una tecla dentro de un teclado de `totalWidth` px.
 * Para negras: centrada en la frontera con la blanca siguiente.
 */
export function keyGeometry(pitch: number, totalWidth: number): KeyGeometry {
  if (!isValidPianoPitch(pitch)) {
    throw new RangeError(`pitch fuera del piano de 88 teclas: ${pitch}`);
  }
  const whiteWidth = totalWidth / WHITE_KEY_COUNT;
  if (!isBlackKey(pitch)) {
    return { x: whiteKeyIndex(pitch) * whiteWidth, width: whiteWidth, isBlack: false };
  }
  const blackWidth = whiteWidth * 0.6;
  // La negra está entre la blanca inferior (pitch-1) y la superior (pitch+1).
  const boundary = (whiteKeyIndex(pitch - 1) + 1) * whiteWidth;
  return { x: boundary - blackWidth / 2, width: blackWidth, isBlack: true };
}
