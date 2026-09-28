import { describe, expect, it } from "vitest";

import { BETA_PLANS } from "./limits";
import {
  FREE_CREDITS,
  FREE_PREVIEW_SECONDS,
  classifyUpload,
  isPreviewSong,
  previewLabel,
  unlockDecision,
} from "./preview";

describe("límites FREE", () => {
  it("FREE = 3 créditos y preview máximo de 60 s", () => {
    expect(FREE_CREDITS).toBe(3);
    expect(FREE_PREVIEW_SECONDS).toBe(60);
  });

  it("los planes de pago conservan sus límites", () => {
    expect(BETA_PLANS.mini).toMatchObject({ includedCredits: 5, maxDurationSeconds: 600 });
    expect(BETA_PLANS.practice).toMatchObject({ includedCredits: 20, maxDurationSeconds: 600 });
    expect(BETA_PLANS.plus).toMatchObject({ includedCredits: 50, maxDurationSeconds: 600 });
  });
});

describe("classifyUpload (duración)", () => {
  it("FREE: canción corta se procesa completa", () => {
    expect(classifyUpload("free", 45)).toEqual({ kind: "full" });
    expect(classifyUpload("free", 60)).toEqual({ kind: "full" });
  });

  it("FREE: canción larga se acepta como preview de 60 s, nunca se rechaza", () => {
    expect(classifyUpload("free", 61)).toEqual({ kind: "preview", previewSeconds: 60 });
    expect(classifyUpload("free", 900)).toEqual({ kind: "preview", previewSeconds: 60 });
  });

  it("planes de pago: hasta 10 min completo, más largo se rechaza", () => {
    expect(classifyUpload("mini", 599)).toEqual({ kind: "full" });
    expect(classifyUpload("practice", 601)).toEqual({
      kind: "rejected",
      code: "duration_exceeded",
      maxSeconds: 600,
    });
    expect(classifyUpload("plus", 3000).kind).toBe("rejected");
  });
});

describe("preview en la biblioteca", () => {
  it("detecta canciones preview", () => {
    expect(isPreviewSong({ preview_seconds: 60 })).toBe(true);
    expect(isPreviewSong({ preview_seconds: null })).toBe(false);
    expect(isPreviewSong({ preview_seconds: 0 })).toBe(false);
  });

  it("etiqueta con duración mostrada y total", () => {
    expect(previewLabel({ preview_seconds: 60, duration: 60.02, source_duration_seconds: 194 })).toBe(
      "Vista previa · 1:00 de 3:14",
    );
    expect(previewLabel({ preview_seconds: 60, duration: 60, source_duration_seconds: null })).toBe(
      "Vista previa · 1:00",
    );
    expect(previewLabel({ preview_seconds: null, duration: 120, source_duration_seconds: null })).toBeNull();
  });
});

describe("unlockDecision (créditos)", () => {
  const preview = { preview_seconds: 60 };
  it("canción completa: sin CTA", () => {
    expect(unlockDecision({ preview_seconds: null }, "mini", 5)).toEqual({ action: "none" });
  });
  it("FREE debe mejorar de plan, tenga o no créditos", () => {
    expect(unlockDecision(preview, "free", 3)).toEqual({ action: "upgrade" });
    expect(unlockDecision(preview, "free", 0)).toEqual({ action: "upgrade" });
  });
  it("plan de pago con créditos puede desbloquear gastando 1", () => {
    expect(unlockDecision(preview, "mini", 5)).toEqual({ action: "unlock", creditsAfter: 4 });
    expect(unlockDecision(preview, "plus", 1)).toEqual({ action: "unlock", creditsAfter: 0 });
  });
  it("plan de pago sin créditos vuelve a precios", () => {
    expect(unlockDecision(preview, "practice", 0)).toEqual({ action: "upgrade" });
  });
  it("plan desconocido se trata como upgrade", () => {
    expect(unlockDecision(preview, "enterprise", 99)).toEqual({ action: "upgrade" });
  });
});
