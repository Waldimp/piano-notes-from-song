/** Central beta plan limits (mirrors public.plan_limits; SQL is enforcement source of truth). */
export const BETA_PLANS = {
  free: {
    planCode: "free",
    maxDurationSeconds: 60,
    includedCredits: 3,
    maxActiveRequests: 1,
    requestsPerMinute: 4,
  },
  mini: {
    planCode: "mini",
    maxDurationSeconds: 600,
    includedCredits: 5,
    maxActiveRequests: 1,
    requestsPerMinute: 6,
  },
  practice: {
    planCode: "practice",
    maxDurationSeconds: 600,
    includedCredits: 20,
    maxActiveRequests: 1,
    requestsPerMinute: 8,
  },
  plus: {
    planCode: "plus",
    maxDurationSeconds: 600,
    includedCredits: 50,
    maxActiveRequests: 1,
    requestsPerMinute: 10,
  },
} as const;

export type BetaPlanCode = keyof typeof BETA_PLANS;

export const ALLOWED_AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".flac", ".ogg"]);
export const ALLOWED_AUDIO_MIME = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/flac",
  "audio/ogg",
  "audio/vorbis",
]);
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB beta cap
