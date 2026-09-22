import { describe, expect, it } from "vitest";

import { mapBillingCheckoutError, mapCreateRequestError } from "./userMessages";

describe("mapCreateRequestError", () => {
  it("maps known codes", () => {
    expect(mapCreateRequestError({ code: "no_credits" })).toMatch(/tutoriales/i);
    expect(mapCreateRequestError({ code: "duration_exceeded" })).toMatch(/duración/i);
    expect(mapCreateRequestError({ code: "active_limit" })).toMatch(/en proceso/i);
  });

  it("maps 401", () => {
    expect(mapCreateRequestError({ status: 401 })).toMatch(/sesión/i);
  });
});

describe("mapBillingCheckoutError", () => {
  it("maps billing disabled", () => {
    expect(mapBillingCheckoutError({ code: "billing_disabled" })).toMatch(/pagos/i);
  });

  it("subscriptions stay blocked copy", () => {
    expect(mapBillingCheckoutError({ code: "subscriptions_disabled" })).toMatch(/pronto/i);
  });
});
