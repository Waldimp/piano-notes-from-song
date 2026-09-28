"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "pianissimo_onboarding_dismissed_v2";

export default function OnboardingBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") return;
      setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  return (
    <aside className="stack" aria-labelledby="onboarding-title" style={{ marginTop: "1.25rem" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 id="onboarding-title" style={{ fontSize: "1.1rem" }}>
          Así funciona
        </h2>
        <button type="button" className="btn ghost small" onClick={dismiss}>
          Entendido
        </button>
      </div>
      <div className="howto">
        <div>
          <b>1 · Sube</b>
          Un audio de piano en MP3, WAV, M4A, FLAC u OGG.
        </div>
        <div>
          <b>2 · Analizamos</b>
          La IA detecta cada nota, su duración y el pedal.
        </div>
        <div>
          <b>3 · Practica</b>
          Notas que caen sobre un piano de 88 teclas, a tu ritmo.
        </div>
        <div>
          <b>4 · Repite</b>
          Baja la velocidad y repite en loop la parte difícil.
        </div>
      </div>
    </aside>
  );
}
