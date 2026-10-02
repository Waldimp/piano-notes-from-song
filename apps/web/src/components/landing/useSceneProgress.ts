"use client";

/**
 * Progreso 0–1 de una "escena" de scroll: una sección alta con un escenario
 * `position: sticky` dentro. p = 0 cuando la sección llega arriba, p = 1
 * cuando el escenario se despega. Se evalúa por frame (rAF) y solo avisa
 * cuando cambia, con la posición real del documento, así funciona igual con
 * la inercia de ScrollFx, con el dedo y con el teclado.
 */

import { type RefObject, useEffect, useRef } from "react";

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Progreso dentro del tramo [a, b] de p. */
export const seg = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
/** Suavizado (smoothstep). */
export const ease = (t: number) => t * t * (3 - 2 * t);

export function useSceneProgress(ref: RefObject<HTMLElement | null>, onFrame: (p: number) => void) {
  const cb = useRef(onFrame);
  cb.current = onFrame;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let lastP = -1;
    const loop = () => {
      const r = el.getBoundingClientRect();
      const total = r.height - window.innerHeight;
      const p = total <= 0 ? 0 : clamp01(-r.top / total);
      if (Math.abs(p - lastP) > 0.0004) {
        lastP = p;
        cb.current(p);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ref]);
}
