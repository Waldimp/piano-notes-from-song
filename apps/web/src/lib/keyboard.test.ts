import { describe, expect, it } from "vitest";

import {
  noteName,
  WHITE_KEY_COUNT,
  isBlackKey,
  isValidPianoPitch,
  keyGeometry,
  whiteKeyIndex,
} from "./keyboard";

const ALL_PITCHES = Array.from({ length: 88 }, (_, i) => 21 + i);

describe("isBlackKey", () => {
  it("el piano tiene 52 blancas y 36 negras", () => {
    const blacks = ALL_PITCHES.filter(isBlackKey);
    expect(blacks).toHaveLength(36);
    expect(ALL_PITCHES.length - blacks.length).toBe(WHITE_KEY_COUNT);
  });

  it("clasifica la octava central", () => {
    // C4=60 D4=62 E4=64 F4=65 G4=67 A4=69 B4=71 blancas
    for (const p of [60, 62, 64, 65, 67, 69, 71]) expect(isBlackKey(p)).toBe(false);
    // C#4=61 D#4=63 F#4=66 G#4=68 A#4=70 negras
    for (const p of [61, 63, 66, 68, 70]) expect(isBlackKey(p)).toBe(true);
  });

  it("extremos del piano: A0 y C8 son blancas", () => {
    expect(isBlackKey(21)).toBe(false);
    expect(isBlackKey(108)).toBe(false);
  });
});

describe("whiteKeyIndex", () => {
  it("A0 es la blanca 0 y C8 la 51", () => {
    expect(whiteKeyIndex(21)).toBe(0);
    expect(whiteKeyIndex(108)).toBe(51);
  });

  it("C4 (nota 60) es la blanca 23", () => {
    expect(whiteKeyIndex(60)).toBe(23);
  });

  it("los índices de las blancas son 0..51 consecutivos", () => {
    const indices = ALL_PITCHES.filter((p) => !isBlackKey(p)).map(whiteKeyIndex);
    expect(indices).toEqual(Array.from({ length: 52 }, (_, i) => i));
  });
});

describe("keyGeometry", () => {
  const W = 5200; // ancho cómodo: blanca = 100px

  it("rechaza pitches fuera del piano", () => {
    expect(() => keyGeometry(20, W)).toThrow(RangeError);
    expect(() => keyGeometry(109, W)).toThrow(RangeError);
    expect(() => keyGeometry(60.5, W)).toThrow(RangeError);
  });

  it("las blancas cubren exactamente el ancho total sin huecos", () => {
    const whites = ALL_PITCHES.filter((p) => !isBlackKey(p)).map((p) => keyGeometry(p, W));
    expect(whites[0].x).toBe(0);
    for (let i = 1; i < whites.length; i++) {
      expect(whites[i].x).toBeCloseTo(whites[i - 1].x + whites[i - 1].width, 6);
    }
    const last = whites[whites.length - 1];
    expect(last.x + last.width).toBeCloseTo(W, 6);
  });

  it("las negras son más angostas y quedan dentro del teclado", () => {
    for (const p of ALL_PITCHES.filter(isBlackKey)) {
      const g = keyGeometry(p, W);
      expect(g.isBlack).toBe(true);
      expect(g.width).toBeLessThan(100);
      expect(g.x).toBeGreaterThan(0);
      expect(g.x + g.width).toBeLessThan(W);
    }
  });

  it("C#4 queda centrada entre C4 y D4", () => {
    const c4 = keyGeometry(60, W);
    const cs4 = keyGeometry(61, W);
    const boundary = c4.x + c4.width;
    expect(cs4.x + cs4.width / 2).toBeCloseTo(boundary, 6);
  });

  it("todas las x crecen con el pitch (blancas y negras intercaladas)", () => {
    const centers = ALL_PITCHES.map((p) => {
      const g = keyGeometry(p, W);
      return g.x + g.width / 2;
    });
    for (let i = 1; i < centers.length; i++) {
      expect(centers[i]).toBeGreaterThan(centers[i - 1]);
    }
  });
});

describe("isValidPianoPitch", () => {
  it.each([[21, true], [108, true], [20, false], [109, false], [60.5, false]])(
    "pitch %p → %p",
    (pitch, expected) => {
      expect(isValidPianoPitch(pitch as number)).toBe(expected);
    },
  );
});

describe("noteName", () => {
  it.each([
    [60, "C"], [61, "C#"], [62, "D"], [63, "D#"], [64, "E"], [65, "F"],
    [66, "F#"], [67, "G"], [68, "G#"], [69, "A"], [70, "A#"], [71, "B"],
  ])("pitch %p → %p", (pitch, expected) => {
    expect(noteName(pitch as number)).toBe(expected);
  });

  it("con octava sigue la convención MIDI (C4 = 60, A0 = 21, C8 = 108)", () => {
    expect(noteName(60, true)).toBe("C4");
    expect(noteName(21, true)).toBe("A0");
    expect(noteName(108, true)).toBe("C8");
    expect(noteName(70, true)).toBe("A#4");
  });
});
