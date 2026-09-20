import assert from "node:assert/strict";
import test from "node:test";
import { assertProductionCanaryEnvironment } from "./environment-guard.mjs";

const validEnvironment = () => ({
  PIANO_ENVIRONMENT: "production-canary",
  PRODUCTION_CANARY_SUPABASE_URL: "https://project.supabase.co",
  PRODUCTION_CANARY_SUPABASE_SERVICE_ROLE_KEY: "test-only",
  PRODUCTION_CANARY_MODAL_DISPATCH_URL: "https://worker.modal.run",
  PRODUCTION_CANARY_IDENTITY_MANIFEST: "{}",
  PRODUCTION_CANARY_IDENTITY_SHA256: "0".repeat(64),
  PRODUCTION_CANARY_DISPATCH_SHARED_SECRET: "test-only",
  PRODUCTION_CANARY_MODAL_PROXY_KEY: "test-only",
  PRODUCTION_CANARY_MODAL_PROXY_SECRET: "test-only",
});

for (const name of [
  "STAGING_UNKNOWN_VARIABLE",
  "STAGING_SUPABASE_DB_URL",
  "DATABASE_URL",
  "SUPABASE_PROJECT_REF",
]) {
  test(`rejects ${name} when present with an empty value`, () => {
    assert.throws(
      () => assertProductionCanaryEnvironment({ ...validEnvironment(), [name]: "" }),
      /generic or staging variables are forbidden/,
    );
  });
}

test("allows Supabase runtime built-ins, including empty values", () => {
  assert.doesNotThrow(() => assertProductionCanaryEnvironment({
    ...validEnvironment(),
    SUPABASE_URL: "",
    SUPABASE_ANON_KEY: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    SUPABASE_DB_URL: "",
  }));
});

test("allows unrelated runtime variables without making them configuration", () => {
  assert.doesNotThrow(() => assertProductionCanaryEnvironment({
    ...validEnvironment(), DENO_DEPLOYMENT_ID: "runtime-internal",
  }));
});

test("does not let a Supabase built-in replace missing production-canary configuration", () => {
  const environment = validEnvironment();
  delete environment.PRODUCTION_CANARY_SUPABASE_URL;
  environment.SUPABASE_URL = "https://fallback.supabase.co";
  assert.throws(
    () => assertProductionCanaryEnvironment(environment),
    /production-canary configuration is required/,
  );
});
