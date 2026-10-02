"use client";

/**
 * Efectos de scroll de la landing, sin dependencias:
 *
 * - Scroll con inercia: la rueda del ratón no salta, el desplazamiento se
 *   acerca al objetivo con una curva exponencial (sensación "slow motion").
 *   Táctil, teclado y barra de scroll siguen siendo nativos; cuando no
 *   animamos nos sincronizamos con la posición real.
 * - Parallax: elementos con `data-parallax="0.2"` se desplazan a otra
 *   velocidad según su posición respecto al centro del viewport.
 * - Hero: `data-hero-fade` se desvanece y se aleja al empezar a bajar;
 *   `data-hero-bg` se mueve más lento que el contenido.
 * - Anclas internas (#demo) se animan con la misma inercia.
 *
 * Todo en un único requestAnimationFrame con transform/opacity; nada de
 * estado de React por frame. Con prefers-reduced-motion no hace nada.
 */

import { useEffect } from "react";

const STIFFNESS = 6.5; // mayor = llega antes al objetivo
const MAX_WHEEL_STEP = 140; // px por evento de rueda (suaviza ruedas "rápidas")

export default function ScrollFx() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (reduce) return;

    const root = document.documentElement;
    root.classList.add("fx-scroll");
    // El scroll suave nativo pelearía con nuestra inercia frame a frame.
    const prevBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";

    let target = window.scrollY;
    let current = window.scrollY;
    let animating = false;
    let last = performance.now();
    let raf = 0;

    const maxScroll = () => Math.max(0, root.scrollHeight - window.innerHeight);
    const clamp = (v: number) => Math.min(maxScroll(), Math.max(0, v));

    const parallax = () => Array.from(document.querySelectorAll<HTMLElement>("[data-parallax]"));
    const heroFade = () => Array.from(document.querySelectorAll<HTMLElement>("[data-hero-fade]"));
    const heroBg = () => Array.from(document.querySelectorAll<HTMLElement>("[data-hero-bg]"));
    let px = parallax();
    let hf = heroFade();
    let hb = heroBg();

    const paint = () => {
      const y = window.scrollY;
      const vh = window.innerHeight;
      for (const el of px) {
        const speed = Number(el.dataset.parallax ?? "0.15");
        const r = el.getBoundingClientRect();
        // progreso -1 (abajo del viewport) … 0 (centro) … 1 (arriba)
        const progress = (vh / 2 - (r.top + r.height / 2)) / vh;
        el.style.transform = `translate3d(0, ${(-progress * speed * 160).toFixed(2)}px, 0)`;
      }
      for (const el of hf) {
        const t = Math.min(1, y / (vh * 0.7));
        el.style.opacity = String(1 - t * 0.95);
        el.style.transform = `translate3d(0, ${(y * 0.28).toFixed(1)}px, 0) scale(${(1 - t * 0.06).toFixed(4)})`;
      }
      for (const el of hb) {
        el.style.transform = `translate3d(0, ${(y * 0.45).toFixed(1)}px, 0)`;
      }
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (animating) {
        current += (target - current) * (1 - Math.exp(-dt * STIFFNESS));
        if (Math.abs(target - current) < 0.4) {
          current = target;
          animating = false;
        }
        window.scrollTo(0, current);
      } else {
        // scroll nativo (táctil, teclado, barra): seguimos a la posición real
        current = target = window.scrollY;
      }
      paint();
      raf = requestAnimationFrame(frame);
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // zoom del navegador
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
      const step = Math.max(-MAX_WHEEL_STEP, Math.min(MAX_WHEEL_STEP, e.deltaY * unit));
      e.preventDefault();
      if (!animating) current = window.scrollY;
      target = clamp(target + step * 1.35);
      animating = true;
    };

    const onAnchor = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href^="#"]');
      if (!a) return;
      const el = document.querySelector<HTMLElement>(a.getAttribute("href") ?? "");
      if (!el) return;
      e.preventDefault();
      if (!animating) current = window.scrollY;
      target = clamp(el.getBoundingClientRect().top + window.scrollY - 56);
      animating = true;
    };

    const onResize = () => {
      px = parallax();
      hf = heroFade();
      hb = heroBg();
      target = clamp(target);
    };

    if (finePointer) window.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("click", onAnchor);
    window.addEventListener("resize", onResize);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("wheel", onWheel);
      document.removeEventListener("click", onAnchor);
      window.removeEventListener("resize", onResize);
      root.classList.remove("fx-scroll");
      root.style.scrollBehavior = prevBehavior;
      for (const el of [...px, ...hf, ...hb]) {
        el.style.transform = "";
        el.style.opacity = "";
      }
    };
  }, []);

  return null;
}
