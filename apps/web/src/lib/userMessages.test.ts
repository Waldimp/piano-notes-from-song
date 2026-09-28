import { describe, expect, it } from "vitest";

import { jobErrorMessage, mapBillingCheckoutError, mapCreateRequestError, planLabel } from "./userMessages";

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

describe("jobErrorMessage", () => {
  it("nunca expone códigos internos", () => {
    for (const raw of ["cancelled_beta_e2e", "cancelled_beta_e2e_modal_lost", "test_cleanup", "RuntimeError", null]) {
      const msg = jobErrorMessage(raw);
      expect(msg).not.toMatch(/_/);
      expect(msg).not.toMatch(/e2e|cleanup|RuntimeError/i);
      expect(msg.length).toBeGreaterThan(20);
    }
  });
  it("explica errores de audio", () => {
    expect(jobErrorMessage("AudioDecodeError")).toMatch(/audio/i);
  });
});

describe("mapCreateRequestError oculta mensajes técnicos", () => {
  it("snake_case y uuid caen al mensaje genérico", () => {
    expect(mapCreateRequestError({ message: "authorize_beta_request failed: uuid x" })).toMatch(/No pudimos preparar/);
    expect(mapCreateRequestError({ error: "cancelled_beta_e2e" })).toMatch(/No pudimos preparar/);
  });
  it("preview: upgrade y upload expirado", () => {
    expect(mapCreateRequestError({ code: "upgrade_required" })).toMatch(/Mini Pack/);
    expect(mapCreateRequestError({ code: "upload_expired" })).toMatch(/subir/i);
  });
});

describe("planLabel", () => {
  it("códigos desconocidos no se muestran en crudo", () => {
    expect(planLabel("free")).toBe("Gratis");
    expect(planLabel("weird_code")).toBe("Plan");
  });
});
