import assert from "node:assert/strict";
import test from "node:test";
import { assertProductionCanaryEnvironment } from "./environment-guard.mjs";

const validEnvironment = () => ({ PIANO_ENVIRONMENT: "production-canary" });

for (const name of [
  "STAGING_UNKNOWN_VARIABLE",
  "STAGING_SUPABASE_DB_URL",
  "STAGING_RECONCILER_SHARED_SECRET",
  "STAGING_PROJECT_REF",
  "SUPABASE_URL",
  "DATABASE_URL",
]) {
  test(`rejects ${name} when present with an empty value`, () => {
    assert.throws(
      () => assertProductionCanaryEnvironment({ ...validEnvironment(), [name]: "" }),
      /generic or staging variables are forbidden/,
    );
  });
}

test("allows a production-canary environment with no cross-profile keys", () => {
  assert.doesNotThrow(() => assertProductionCanaryEnvironment(validEnvironment()));
});
