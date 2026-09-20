export const GENERIC_FORBIDDEN_VARIABLES = new Set([
  "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL", "SUPABASE_DB_URL",
]);

export const assertProductionCanaryEnvironment = (environment) => {
  if (environment.PIANO_ENVIRONMENT !== "production-canary") {
    throw new Error("production-canary only");
  }
  if (Object.keys(environment).some(
    (name) => name.startsWith("STAGING_") || GENERIC_FORBIDDEN_VARIABLES.has(name),
  )) {
    throw new Error("generic or staging variables are forbidden");
  }
};
