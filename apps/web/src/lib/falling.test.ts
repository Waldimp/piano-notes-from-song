import { describe, expect, it } from "vitest";

import {
  isSounding,
  lowerBoundByStart,
  maxDuration,
  noteBar,
  visibleRange,
} from "./falling";

const KEYBOARD_Y = 600;
const PPS = 200; // píxeles por segundo → lookahead = 3 s

describe("noteBar", () => {
  const note = { start: 10, end: 10.5 }; // barra de 100 px

  it("la base de la barra toca el teclado exactamente en t = start", () => {
    const bar = noteBar(note, 10, KEYBOARD_Y, PPS);
    expect(bar.bottomY).toBe(KEYBOARD_Y);
    expect(bar.topY).toBe(KEYBOARD_Y - 100);
  });

  it("antes de start la barra está por encima del teclado", () => {
    const bar = noteBar(note, 9, KEYBOARD_Y, PPS); // 1 s antes → 200 px arriba
    expect(bar.bottomY).toBe(KEYBOARD_Y - 200);
  });

  it("en t = end la barra desapareció bajo la línea del teclado", () => {
    const bar = noteBar(note, 10.5, KEYBOARD_Y, PPS);
    expect(bar.topY).toBe(KEYBOARD_Y);
  });

  it("la altura es proporcional a la duración", () => {
    const bar = noteBar({ start: 0, end: 2 }, 0, KEYBOARD_Y, PPS);
    expect(bar.bottomY - bar.topY).toBe(400);
  });
});

describe("isSounding", () => {
  const note = { start: 5, end: 6 };
  it.each([
    [4.99, false],
    [5, true],
    [5.5, true],
    [6, false], // end es exclusivo
    [7, false],
  ])("t=%p → %p", (t, expected) => {
    expect(isSounding(note, t as number)).toBe(expected);
  });
});

describe("lowerBoundByStart", () => {
  const notes = [{ start: 1 }, { start: 2 }, { start: 2 }, { start: 5 }];
  it.each([
    [0, 0],
    [1, 0],
    [1.5, 1],
    [2, 1],
    [3, 3],
    [5.1, 4],
  ])("target=%p → índice %p", (target, expected) => {
    expect(lowerBoundByStart(notes, target as number)).toBe(expected);
  });

  it("lista vacía → 0", () => {
    expect(lowerBoundByStart([], 3)).toBe(0);
  });
});

describe("visibleRange", () => {
  // Ordenadas por start; duración máxima = 2 s
  const notes = [
    { start: 0, end: 2 },
    { start: 1, end: 1.2 },
    { start: 4, end: 4.5 },
    { start: 10, end: 11 },
    { start: 20, end: 22 },
  ];
  const maxDur = maxDuration(notes);
  const lookahead = 3;

  function visibleAt(t: number) {
    const { lo, hi } = visibleRange(notes, t, lookahead, maxDur);
    return notes.slice(lo, hi).filter((n) => n.end > t);
  }

  it("maxDuration calcula la duración máxima", () => {
    expect(maxDur).toBe(2);
  });

  it("en t=0 se ven las notas hasta 3 s en el futuro", () => {
    expect(visibleAt(0)).toEqual([notes[0], notes[1]]);
  });

  it("en t=1.5 la nota corta ya terminó pero la larga sigue", () => {
    expect(visibleAt(1.5)).toEqual([notes[0], { start: 4, end: 4.5 }]);
  });

  it("en t=8 solo se ve la nota que empieza en 10 (dentro del lookahead)", () => {
    expect(visibleAt(8)).toEqual([{ start: 10, end: 11 }]);
  });

  it("en t=15 no se ve nada", () => {
    expect(visibleAt(15)).toEqual([]);
  });

  it("el rango nunca escanea notas lejanas en el pasado", () => {
    const { lo } = visibleRange(notes, 15, lookahead, maxDur);
    expect(lo).toBeGreaterThanOrEqual(3); // las tres primeras quedan excluidas por índice
  });

  it("cubre notas largas que empezaron antes de la ventana", () => {
    // nota de 2 s que empezó en t-1: sigue sonando y debe verse
    expect(visibleAt(1)).toContainEqual({ start: 0, end: 2 });
  });
});
