"use client";

/**
 * Escena de apertura de la landing, contada con el scroll (vectores, no
 * fotogramas), en cinco tiempos:
 *
 *  1. el texto se despide y el logo baja al centro y crece;
 *  2. la tapa se abre y, mientras, las notas del fondo se frenan y se apagan
 *     hasta dejar el papel limpio;
 *  3. el cuerpo se estira tanto que se rompe: salen esquirlas hacia arriba;
 *  4. las esquirlas se reparten por los carriles y, al llegar arriba, se
 *     vuelven las notas del tutorial, que caen de nuevo al ritmo del scroll;
 *  5. un remate con CTA.
 *
 * Todo imperativo sobre refs (transform/opacity por frame, sin estado de
 * React). La sección mide varias pantallas; el escenario es sticky.
 */

import Link from "next/link";
import { useRef } from "react";

import HeroDemo from "@/components/HeroDemo";
import Logo from "@/components/soft/Logo";
import SoftBackdrop from "@/components/soft/SoftBackdrop";
import { FREE_CREDITS, FREE_PREVIEW_SECONDS } from "@/lib/beta/preview";
import { clamp01, ease, seg, useSceneProgress } from "./useSceneProgress";

/** Segundos de demo que avanzan las notas antes de la pausa y después del regreso. */
const SCRUB_BEFORE = 6;
const SCRUB_AFTER = 10;

/* Tiempos (progreso 0–1 de la escena). */
const T = {
  bye: [0, 0.22],
  center: [0.03, 0.34],
  lidOpen: [0.26, 0.5],
  lidFade: [0.46, 0.56],
  calm: [0.26, 0.5], // notas del fondo se frenan y se apagan
  stretch: [0.42, 0.6],
  snap: [0.6, 0.64], // el cuerpo se rompe
  burst: [0.6, 0.9], // esquirlas hacia arriba
  back: [0.78, 0.92], // el tutorial vuelve
  tag: [0.88, 0.98],
} as const;

/** Pseudoaleatorio determinista (misma salida en servidor y cliente). */
const rnd = (i: number, k: number) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

type Shard = { lane: number; delay: number; w: number; h: number; tone: string; rot: number; rise: number };
const TONES = ["#809671", "#d2ab80", "#b3b792", "#e5d2b8", "#725c3a", "#809671", "#d2ab80"];
const SHARDS: Shard[] = Array.from({ length: 30 }, (_, i) => ({
  lane: (i + 0.5) / 30 + (rnd(i, 1) - 0.5) * 0.03,
  delay: rnd(i, 2) * 0.35,
  w: 9 + Math.round(rnd(i, 3) * 9),
  h: 26 + Math.round(rnd(i, 4) * 70),
  tone: TONES[i % TONES.length],
  rot: (rnd(i, 5) - 0.5) * 70,
  rise: 0.06 + rnd(i, 6) * 0.4,
}));

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export default function HeroScene() {
  const wrap = useRef<HTMLElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const logo = useRef<HTMLDivElement>(null);
  const kb = useRef<HTMLDivElement>(null);
  const shade = useRef<HTMLDivElement>(null);
  const shards = useRef<HTMLDivElement>(null);
  const tag = useRef<HTMLDivElement>(null);
  const cue = useRef<HTMLDivElement>(null);
  const clock = useRef({ seconds: 0, rate: 1 });

  useSceneProgress(wrap, (p) => {
    const vh = window.innerHeight;
    const vw = window.innerWidth;

    // reloj de las notas: avanzan con el scroll, se detienen en la pausa y vuelven al final
    const calm = ease(seg(p, ...T.calm));
    const back = ease(seg(p, ...T.back));
    clock.current.rate = clamp01(1 - calm + back);
    clock.current.seconds = SCRUB_BEFORE * ease(seg(p, 0, T.calm[1])) + SCRUB_AFTER * seg(p, T.back[0], 1);

    // 1 · el texto se despide
    const bye = ease(seg(p, ...T.bye));
    if (text.current) {
      text.current.style.opacity = String(1 - bye);
      text.current.style.transform = `translate3d(0, ${(-44 * bye).toFixed(1)}px, 0)`;
      text.current.style.visibility = bye >= 1 ? "hidden" : "";
    }
    if (cue.current) cue.current.style.opacity = String(1 - seg(p, 0, 0.08));

    // 2 · el logo baja al centro y crece; la tapa se abre
    const center = ease(seg(p, ...T.center));
    const open = ease(seg(p, ...T.lidOpen));
    const stretch = ease(seg(p, ...T.stretch));
    const snap = seg(p, ...T.snap);
    if (logo.current) {
      const el = logo.current;
      el.style.transform = `translate3d(0, ${(vh * 0.24 * center).toFixed(1)}px, 0) scale(${(1 + 0.95 * center).toFixed(4)})`;
      el.style.visibility = snap >= 1 ? "hidden" : "";
      const lid = el.querySelector<SVGPathElement>(".logo-lid");
      const body = el.querySelector<SVGPathElement>(".logo-body");
      if (lid) {
        lid.style.transform = `rotate(${(-30 * open).toFixed(2)}deg) translate(${(-8 * open).toFixed(1)}px, ${(-12 * open).toFixed(1)}px)`;
        lid.style.opacity = String(1 - ease(seg(p, ...T.lidFade)));
      }
      if (body) {
        // 3 · se estira hasta romperse: al final, un latigazo vertical y desaparece
        const sx = 1 + 2.6 * stretch + 0.3 * snap;
        const sy = 1 - 0.45 * stretch - 0.5 * snap;
        body.style.transform = `scale(${sx.toFixed(4)}, ${Math.max(0.02, sy).toFixed(4)})`;
        body.style.opacity = String(1 - snap);
      }
    }

    // el fondo (teclado + notas) se apaga en la pausa y vuelve con las esquirlas
    const kbAlpha = clamp01(1 - calm + back);
    if (shade.current) shade.current.style.opacity = String(clamp01(1 - calm) * 0.9 + 0.08);
    if (kb.current) {
      kb.current.style.opacity = String(kbAlpha);
      kb.current.style.transform = `translate3d(0, ${(vh * 0.05 * (1 - back) * calm).toFixed(1)}px, 0) scale(${(1 + 0.05 * calm * (1 - back)).toFixed(4)})`;
    }

    // 4 · esquirlas: nacen a lo largo del cuerpo estirado y suben a sus carriles
    const burst = seg(p, ...T.burst);
    if (shards.current) {
      shards.current.style.visibility = burst > 0 && burst < 1 ? "visible" : "hidden";
      const items = shards.current.children;
      const cy = vh * 0.5 + vh * 0.06;
      for (let i = 0; i < items.length; i++) {
        const s = SHARDS[i];
        const el = items[i] as HTMLElement;
        const q = easeOut(seg(burst, s.delay, 1));
        const x0 = vw * 0.5 + (s.lane - 0.5) * vw * 0.42;
        const x1 = s.lane * vw;
        const y1 = vh * s.rise;
        const x = x0 + (x1 - x0) * q;
        const y = cy + (y1 - cy) * q;
        const alpha = Math.min(seg(q, 0, 0.12), 1 - seg(q, 0.72, 1));
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${(s.rot * (1 - q)).toFixed(1)}deg) scale(${(0.55 + 0.45 * q).toFixed(3)})`;
        el.style.opacity = alpha.toFixed(3);
      }
    }

    // 5 · remate
    const t = ease(seg(p, ...T.tag));
    if (tag.current) {
      tag.current.style.opacity = String(t);
      tag.current.style.transform = `translate3d(0, ${(26 * (1 - t)).toFixed(1)}px, 0)`;
      tag.current.style.pointerEvents = t > 0.6 ? "auto" : "none";
    }
  });

  return (
    <section ref={wrap} className="hero scene" aria-label="Pianissimo">
      <div className="scene-stage">
        <div ref={kb} className="hero-bg">
          <HeroDemo speed={0.6} startAt={3} minWidth={1100} offsetRef={clock} />
        </div>
        <div ref={shade} className="hero-shade" aria-hidden="true" />
        <SoftBackdrop rain={0} clouds={false} />

        <div ref={shards} className="scene-shards" aria-hidden="true">
          {SHARDS.map((s, i) => (
            <i key={i} style={{ width: s.w, height: s.h, background: s.tone }} />
          ))}
        </div>

        <div className="hero-content">
          <div ref={logo} className="scene-logo">
            <Logo />
          </div>
          <div ref={text} className="hero-text">
            <p className="hero-brand">Pianissimo</p>
            <h1 className="hero-title">
              Tu canción. <em>Tu piano.</em> A tu ritmo.
            </h1>
            <p className="hero-lead">
              Sube un audio de piano y míralo caer sobre un teclado real. Practica despacio, en loop y mano por mano,
              sin prisa.
            </p>
            <div className="hero-cta">
              <Link className="btn primary lg" href="/welcome">
                Comenzar
              </Link>
              <Link className="btn lg" href="#demo">
                Ver cómo funciona
              </Link>
            </div>
            <p className="hero-fine">
              {FREE_CREDITS} vistas previas de {FREE_PREVIEW_SECONDS} s gratis · sin tarjeta
            </p>
          </div>
        </div>

        <div ref={tag} className="scene-tag">
          <div className="scene-tag-card">
            <p className="eyebrow">Así se ve tu canción</p>
            <h2>
              Cada nota, <span className="script">en su tecla</span>
            </h2>
            <p>Las barras caen sobre un piano de 88 teclas. Matcha, la mano derecha; chai, la izquierda.</p>
            <Link className="btn primary lg" href="/welcome">
              Comenzar gratis
            </Link>
          </div>
        </div>

        <div ref={cue} className="hero-scroll" aria-hidden="true">
          <i />
          <span>Desliza</span>
        </div>
      </div>
    </section>
  );
}
