import { describe, expect, it } from "vitest";

import {
  PLAYBACK_SPEEDS,
  SEEK_STEP_SECONDS,
  clampTime,
  coerceSeekIntoLoop,
  isValidLoop,
  loopWrapTarget,
  nudgeTime,
  resetPlaybackTime,
  selectActivePitches,
} from "./playback";

describe("PLAYBACK_SPEEDS", () => {
  it("incluye 0.5 / 0.75 / 1 / 1.25", () => {
    expect([...PLAYBACK_SPEEDS]).toEqual([0.5, 0.75, 1, 1.25]);
  });
});

describe("clampTime", () => {
  it("acota a [0, duration]", () => {
    expect(clampTime(-1, 10)).toBe(0);
    expect(clampTime(5, 10)).toBe(5);
    expect(clampTime(99, 10)).toBe(10);
  });

  it("duration inválida → 0", () => {
    expect(clampTime(3, 0)).toBe(0);
    expect(clampTime(3, NaN)).toBe(0);
  });
});

describe("loop", () => {
  it("isValidLoop exige B > A", () => {
    expect(isValidLoop(1, 2)).toBe(true);
    expect(isValidLoop(2, 2)).toBe(false);
    expect(isValidLoop(null, 2)).toBe(false);
  });

  it("loopWrapTarget vuelve a A al alcanzar B", () => {
    expect(loopWrapTarget(1.9, 1, 2)).toBeNull();
    expect(loopWrapTarget(2, 1, 2)).toBe(1);
    expect(loopWrapTarget(2.5, 1, 2)).toBe(1);
  });

  it("coerceSeekIntoLoop mantiene el scrub dentro del rango", () => {
    expect(coerceSeekIntoLoop(1.5, 1, 3, 10)).toBe(1.5);
    expect(coerceSeekIntoLoop(0.2, 1, 3, 10)).toBe(1);
    expect(coerceSeekIntoLoop(9, 1, 3, 10)).toBe(1);
  });

  it("nudgeTime respeta loop y duration", () => {
    expect(nudgeTime(5, SEEK_STEP_SECONDS, 20)).toBe(10);
    expect(nudgeTime(1, -SEEK_STEP_SECONDS, 20)).toBe(0);
    expect(nudgeTime(2.5, 5, 20, 2, 4)).toBe(2); // cae fuera → A
  });
});

describe("selectActivePitches / reset", () => {
  const notes = [
    { pitch: 60, start: 1, end: 2 },
    { pitch: 64, start: 1.5, end: 3 },
  ];

  it("selecciona notas activas con end exclusivo", () => {
    expect(selectActivePitches(notes, 1)).toEqual([60]);
    expect(selectActivePitches(notes, 1.5)).toEqual([60, 64]);
    expect(selectActivePitches(notes, 2)).toEqual([64]);
    expect(selectActivePitches(notes, 3)).toEqual([]);
  });

  it("resetPlaybackTime es 0", () => {
    expect(resetPlaybackTime()).toBe(0);
  });
});
