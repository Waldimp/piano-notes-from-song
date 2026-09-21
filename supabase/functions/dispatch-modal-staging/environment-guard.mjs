// These names are injected by Supabase Edge Functions. They may exist, but
// production-canary code must never read them; all configuration is required
// separately from the PRODUCTION_CANARY_ namespace below.
export const SUPABASE_RUNTIME_BUILT_INS = new Set([
  "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL",
]);

export const GENERIC_FORBIDDEN_VARIABLES = new Set([
  "DATABASE_URL", "SUPABASE_PROJECT_REF", "MODAL_DISPATCH_URL",
  "DISPATCH_SHARED_SECRET", "MODAL_PROXY_KEY", "MODAL_PROXY_SECRET",
]);

export const REQUIRED_PRODUCTION_CANARY_VARIABLES = [
  "PRODUCTION_CANARY_SUPABASE_URL",
  "PRODUCTION_CANARY_SUPABASE_SERVICE_ROLE_KEY",
  "PRODUCTION_CANARY_MODAL_DISPATCH_URL",
  "PRODUCTION_CANARY_IDENTITY_MANIFEST",
  "PRODUCTION_CANARY_IDENTITY_SHA256",
  "PRODUCTION_CANARY_DISPATCH_SHARED_SECRET",
  "PRODUCTION_CANARY_MODAL_PROXY_KEY",
  "PRODUCTION_CANARY_MODAL_PROXY_SECRET",
];

// Optional: enables control-plane wake without rotating the HMAC secret.
// When present, Authorization: Bearer <wake> may call action=dispatch_next only.
export const OPTIONAL_PRODUCTION_CANARY_VARIABLES = [
  "PRODUCTION_CANARY_DISPATCH_WAKE_SECRET",
];

export const assertProductionCanaryEnvironment = (environment) => {
  if (environment.PIANO_ENVIRONMENT !== "production-canary") {
    throw new Error("production-canary only");
  }
  if (REQUIRED_PRODUCTION_CANARY_VARIABLES.some((name) => !environment[name])) {
    throw new Error("production-canary configuration is required");
  }
  if (Object.keys(environment).some(
    (name) => name.startsWith("STAGING_") || GENERIC_FORBIDDEN_VARIABLES.has(name),
  )) {
    throw new Error("generic or staging variables are forbidden");
  }
};
