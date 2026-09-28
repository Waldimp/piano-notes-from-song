/**
 * FREE preview rules (pure helpers, mirrored by SQL in migration 0017).
 *
 * FREE = 3 credits. Any valid song is accepted; only the first
 * `FREE_PREVIEW_SECONDS` are processed. Paid plans keep their full limits.
 */

import { BETA_PLANS, type BetaPlanCode } from "./limits";

export const FREE_PREVIEW_SECONDS = BETA_PLANS.free.maxDurationSeconds;
export const FREE_CREDITS = BETA_PLANS.free.includedCredits;

export type UploadOutcome =
  | { kind: "full" }
  | { kind: "preview"; previewSeconds: number }
  | { kind: "rejected"; code: "duration_exceeded"; maxSeconds: number };

/** What happens to an upload of `durationSeconds` under `plan` (duration only). */
export function classifyUpload(plan: BetaPlanCode, durationSeconds: number): UploadOutcome {
  const limits = BETA_PLANS[plan];
  if (durationSeconds <= limits.maxDurationSeconds) return { kind: "full" };
  if (plan === "free") return { kind: "preview", previewSeconds: limits.maxDurationSeconds };
  return { kind: "rejected", code: "duration_exceeded", maxSeconds: limits.maxDurationSeconds };
}

export function isPreviewSong(song: { preview_seconds: number | null }): boolean {
  return song.preview_seconds !== null && song.preview_seconds > 0;
}

export type UnlockDecision =
  | { action: "none" }
  | { action: "upgrade" }
  | { action: "unlock"; creditsAfter: number };

/**
 * CTA for a preview song: FREE users must upgrade; paid users with credits can
 * spend one credit to process the full song.
 */
export function unlockDecision(
  song: { preview_seconds: number | null },
  plan: BetaPlanCode | string,
  creditBalance: number,
): UnlockDecision {
  if (!isPreviewSong(song)) return { action: "none" };
  if (plan === "free" || !(plan in BETA_PLANS)) return { action: "upgrade" };
  if (creditBalance < 1) return { action: "upgrade" };
  return { action: "unlock", creditsAfter: creditBalance - 1 };
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

/** "Vista previa · 1:00 de 3:14" */
export function previewLabel(song: {
  preview_seconds: number | null;
  duration: number;
  source_duration_seconds: number | null;
}): string | null {
  if (!isPreviewSong(song)) return null;
  const shown = Math.min(song.preview_seconds ?? 0, song.duration || song.preview_seconds || 0);
  const full = song.source_duration_seconds;
  return full && full > shown
    ? `Vista previa · ${formatClock(shown)} de ${formatClock(full)}`
    : `Vista previa · ${formatClock(shown)}`;
}
