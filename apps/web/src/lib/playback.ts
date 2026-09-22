/**
 * Pure playback helpers for the tutorial player.
 * Audio remains the authoritative clock; these only clamp/seek/loop math.
 */

export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/** Short seek step for ← / → keyboard shortcuts (seconds). */
export const SEEK_STEP_SECONDS = 5;

export function clampTime(t: number, duration: number): number {
  if (!Number.isFinite(t)) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.min(duration, t));
}

export function isValidLoop(a: number | null, b: number | null): boolean {
  return a !== null && b !== null && Number.isFinite(a) && Number.isFinite(b) && b > a;
}

/**
 * When playback reaches/passes B, return A so the caller can seek.
 * Otherwise null (no wrap this frame).
 */
export function loopWrapTarget(
  currentTime: number,
  a: number | null,
  b: number | null,
): number | null {
  if (!isValidLoop(a, b) || a === null || b === null) return null;
  if (currentTime >= b) return a;
  return null;
}

/**
 * Seek while a loop is active: keep the scrubber inside [A, B).
 * Outside the range → snap to A (practice-loop coherence).
 */
export function coerceSeekIntoLoop(
  t: number,
  a: number | null,
  b: number | null,
  duration: number,
): number {
  const clamped = clampTime(t, duration);
  if (!isValidLoop(a, b) || a === null || b === null) return clamped;
  if (clamped < a || clamped >= b) return a;
  return clamped;
}

export function nudgeTime(
  current: number,
  delta: number,
  duration: number,
  a: number | null = null,
  b: number | null = null,
): number {
  return coerceSeekIntoLoop(current + delta, a, b, duration);
}

/** Notes sounding at t using exclusive end (start <= t < end). */
export function selectActivePitches(
  notes: ReadonlyArray<{ pitch: number; start: number; end: number }>,
  currentTime: number,
  lo = 0,
  hi = notes.length,
): number[] {
  const out: number[] = [];
  for (let i = lo; i < hi; i++) {
    const n = notes[i];
    if (n.start <= currentTime && currentTime < n.end) out.push(n.pitch);
  }
  return out;
}

export function resetPlaybackTime(): number {
  return 0;
}
