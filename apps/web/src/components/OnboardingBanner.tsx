"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "pianissimo_onboarding_dismissed_v1";

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

  return (
    <aside className="onboarding" aria-labelledby="onboarding-title">
      <div className="onboarding-head">
        <h2 id="onboarding-title">Cómo funciona Pianissimo</h2>
        <button
          type="button"
          className="btn small"
          aria-label="Cerrar guía"
          onClick={() => {
            try {
              localStorage.setItem(STORAGE_KEY, "1");
            } catch {
              /* ignore */
            }
            setVisible(false);
          }}
        >
          Entendido
        </button>
      </div>
      <ol className="onboarding-steps">
        <li>Crea tu cuenta e inicia sesión.</li>
        <li>Sube un audio de piano (MP3, WAV, etc.).</li>
        <li>Pianissimo analiza las notas y genera un tutorial interactivo.</li>
        <li>Abre la canción y practica con las notas que caen.</li>
      </ol>
    </aside>
  );
}
