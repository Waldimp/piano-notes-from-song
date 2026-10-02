"use client";

/**
 * Demo animada del producto para la landing: usa el MISMO renderer del
 * tutorial (drawFrame) con notas reales transcritas, movido por un reloj
 * sintético en vez de <audio>. 60 fps con requestAnimationFrame, sin estado
 * de React por frame; se pausa fuera del viewport, con la pestaña oculta y
 * con prefers-reduced-motion (muestra un frame estático).
 */

import { useEffect, useRef } from "react";
import type { PianoNote } from "@piano/contracts";

import { DEMO_DURATION, DEMO_NOTES } from "@/lib/demo/notes";
import { maxDuration } from "@/lib/falling";
import { DEFAULT_VIEW_OPTIONS, type HandFilter, drawFrame } from "@/lib/renderer";

const NOTES: PianoNote[] = DEMO_NOTES.map(([pitch, start, end, velocity, hand]) => ({
  pitch,
  start,
  end,
  velocity,
  hand: hand === 0 ? "left" : "right",
}));
const MAX_DUR = maxDuration(NOTES);

export type HeroDemoProps = {
  speed?: number;
  handFilter?: HandFilter;
  /** Loop de práctica en segundos de la demo (A,B). */
  loop?: [number, number] | null;
  /** Empieza en este segundo (para variar la escena entre secciones). */
  startAt?: number;
  /** Anchura mínima del lienzo: en móvil el teclado se dibuja más ancho y se centra. */
  minWidth?: number;
  showNames?: boolean;
  className?: string;
  /**
   * Desplazamiento de tiempo externo (en segundos) que se suma al reloj
   * propio sin re-renderizar: las escenas de scroll lo mueven por frame.
   */
  offsetRef?: React.RefObject<{ seconds: number } | null>;
};

export default function HeroDemo({
  speed = 0.85,
  handFilter = "both",
  loop = null,
  startAt = 4,
  minWidth = 900,
  showNames = false,
  className = "",
  offsetRef,
}: HeroDemoProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ speed, handFilter, loop, showNames });
  propsRef.current = { speed, handFilter, loop, showNames };

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let visible = true;
    let cssW = 0;
    let cssH = 0;
    let t = startAt;
    let spCur = propsRef.current.speed; // la velocidad cambia con suavidad
    let last = performance.now();
    const wrapTime = (v: number) => ((v % DEMO_DURATION) + DEMO_DURATION) % DEMO_DURATION;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cssW = Math.max(rect.width, minWidth);
      cssH = rect.height;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      canvas.style.marginLeft = `${Math.min(0, (rect.width - cssW) / 2)}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const frame = () => {
      const { handFilter: hf, loop: lp, showNames: sn } = propsRef.current;
      const [a, b] = lp ?? [null, null];
      drawFrame(ctx, cssW, cssH, {
        notes: NOTES,
        maxNoteDuration: MAX_DUR,
        currentTime: wrapTime(t + (offsetRef?.current?.seconds ?? 0)),
        loopA: a,
        loopB: b,
        handFilter: hf,
        view: { ...DEFAULT_VIEW_OPTIONS, showNoteNames: sn, noteDurationCap: 1.5 },
      });
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { speed: sp, loop: lp } = propsRef.current;
      spCur += (sp - spCur) * Math.min(1, dt * 3.5);
      t += dt * spCur;
      if (lp && t >= lp[1]) t = lp[0];
      if (t > DEMO_DURATION) t = 0;
      frame();
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (raf || reduced || !visible || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    resize();
    frame();
    const ro = new ResizeObserver(() => {
      resize();
      frame();
    });
    ro.observe(wrap);
    const io = new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible) start();
        else stop();
      },
      { threshold: 0.05 },
    );
    io.observe(wrap);
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVis);
    start();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [startAt, minWidth, offsetRef]);

  return (
    <div ref={wrapRef} className={`hero-demo${className ? ` ${className}` : ""}`} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
