import { describe, expect, it } from "vitest";

import { MediaClock, SEEK_THRESHOLD_SECONDS } from "./clock";

function sample(mediaTime: number, nowMs: number, playbackRate = 1, paused = false, seeking = false) {
  return { mediaTime, nowMs, playbackRate, paused, seeking };
}

describe("MediaClock", () => {
  it("la primera lectura se devuelve tal cual", () => {
    const c = new MediaClock();
    expect(c.update(sample(10, 0))).toBe(10);
  });

  it("interpola entre lecturas iguales (currentTime a saltos gruesos)", () => {
    const c = new MediaClock();
    c.update(sample(10, 0));
    // el audio sigue reportando 10 durante 200 ms: la estimación avanza sola
    expect(c.update(sample(10, 100))).toBeCloseTo(10.1, 6);
    expect(c.update(sample(10, 200))).toBeCloseTo(10.2, 6);
  });

  it("respeta la velocidad de reproducción al interpolar", () => {
    const c = new MediaClock();
    c.update(sample(10, 0, 0.5));
    expect(c.update(sample(10, 200, 0.5))).toBeCloseTo(10.1, 6);
    const c2 = new MediaClock();
    c2.update(sample(10, 0, 1.5));
    expect(c2.update(sample(10, 200, 1.5))).toBeCloseTo(10.3, 6);
  });

  it("una lectura nueva del audio re-ancla (el audio manda)", () => {
    const c = new MediaClock();
    c.update(sample(10, 0));
    c.update(sample(10, 250)); // predicho 10.25
    // el audio reporta 10.24: se acepta el audio; la estimación no retrocede más de lo razonable
    const t = c.update(sample(10.24, 250));
    expect(t).toBeGreaterThanOrEqual(10.24);
    expect(t).toBeLessThanOrEqual(10.29);
    // y a partir de ahí interpola desde la nueva ancla
    expect(c.update(sample(10.24, 350))).toBeCloseTo(10.34, 6);
  });

  it("un seek (salto grande) se acepta de inmediato sin suavizar", () => {
    const c = new MediaClock();
    c.update(sample(10, 0));
    c.update(sample(10, 100));
    const jumped = c.update(sample(3, 120)); // el usuario arrastró hacia atrás
    expect(jumped).toBe(3);
    expect(c.update(sample(3, 220))).toBeCloseTo(3.1, 6);
  });

  it("en pausa no avanza y devuelve exactamente lo reportado", () => {
    const c = new MediaClock();
    c.update(sample(10, 0));
    expect(c.update(sample(10, 500, 1, true))).toBe(10);
    expect(c.update(sample(10, 5000, 1, true))).toBe(10);
  });

  it("mientras el audio está buscando (seeking) devuelve lo reportado", () => {
    const c = new MediaClock();
    c.update(sample(10, 0));
    expect(c.update(sample(42, 100, 1, false, true))).toBe(42);
  });

  it("no extrapola indefinidamente si el audio deja de reportar (buffering)", () => {
    const c = new MediaClock();
    c.update(sample(10, 0));
    const t = c.update(sample(10, 5000)); // 5 s sin lecturas nuevas
    expect(t).toBeLessThan(10 + 1);
  });

  it("reset vuelve a tomar la siguiente lectura como ancla", () => {
    const c = new MediaClock();
    c.update(sample(10, 0));
    c.update(sample(10, 200));
    c.reset();
    expect(c.update(sample(10, 300))).toBe(10);
  });

  it("el umbral de seek distingue jitter de salto", () => {
    const c = new MediaClock();
    c.update(sample(10, 0));
    const small = c.update(sample(10 + SEEK_THRESHOLD_SECONDS / 2, 0));
    expect(small).toBeGreaterThanOrEqual(10 + SEEK_THRESHOLD_SECONDS / 2);
    const big = c.update(sample(20, 0));
    expect(big).toBe(20);
  });
});
