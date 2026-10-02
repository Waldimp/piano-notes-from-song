"use client";

/**
 * Escena de apertura de la landing, contada con el scroll (vectores, no
 * fotogramas), en cinco tiempos:
 *
 *  1. el texto se despide y el logo baja al centro y crece;
 *  2. la tapa se abre y, mientras, las notas que caen se frenan y se apagan;
 *     el teclado de abajo se queda siempre;
 *  3. el cuerpo se estira tanto que se rompe: salen esquirlas hacia arriba;
 *  4. cada esquirla aterriza exactamente sobre una nota real (misma posición,
 *     tamaño y color) y se funde con ella; entonces las notas vuelven a caer
 *     al ritmo del scroll, sin corte;
 *  5. un remate con CTA.
 *
 * Todo imperativo sobre refs (transform/opacity por frame, sin estado de
 * React). La sección mide varias pantallas; el escenario es sticky.
 */

import Link from "next/link";
import { useRef } from "react";

import HeroDemo, { type HeroDemoControl } from "@/components/HeroDemo";
import Logo from "@/components/soft/Logo";
import SoftBackdrop from "@/components/soft/SoftBackdrop";
import { FREE_CREDITS, FREE_PREVIEW_SECONDS } from "@/lib/beta/preview";
import type { NoteRect } from "@/lib/renderer";
import { clamp01, ease, seg, useSceneProgress } from "./useSceneProgress";

/** Segundos de demo que avanzan las notas antes de la pausa y después del regreso. */
const SCRUB_BEFORE = 6;
const SCRUB_AFTER = 10;
/** Máximo de esquirlas (notas visibles a la vez en la demo: ~20–45). */
const MAX_SHARDS = 80;

/* Tiempos (progreso 0–1 de la escena). */
const T = {
  bye: [0, 0.22],
  center: [0.03, 0.34],
  lidOpen: [0.26, 0.5],
  lidFade: [0.46, 0.56],
  calm: [0.26, 0.5], // las notas se frenan y se apagan (el teclado se queda)
  stretch: [0.42, 0.6],
  snap: [0.6, 0.64], // el cuerpo se rompe
  burst: [0.6, 0.84], // esquirlas hacia sus notas
  merge: [0.82, 0.9], // esquirla → nota real, en el sitio
  resume: [0.89, 0.97], // las notas vuelven a caer
  tag: [0.9, 0.98],
} as const;

/** Pseudoaleatorio determinista. */
const rnd = (i: number, k: number) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

type Flight = { x0: number; y0: number; x1: number; y1: number; delay: number; rot: number };

export default function HeroScene() {
  const wrap = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const logo = useRef<HTMLDivElement>(null);
  const shade = useRef<HTMLDivElement>(null);
  const shards = useRef<HTMLDivElement>(null);
  const tag = useRef<HTMLDivElement>(null);
  const cue = useRef<HTMLDivElement>(null);
  const clock = useRef({ seconds: 0, rate: 1, notesAlpha: 1 });
  const demo = useRef<HeroDemoControl>(null);
  const flights = useRef<Flight[]>([]);
  const prevBurst = useRef(-1);

  /** Al romperse el cuerpo: cada esquirla toma una nota real como destino. */
  const planFlights = () => {
    const layer = shards.current;
    const ctl = demo.current;
    if (!layer || !ctl) return;
    const base = layer.getBoundingClientRect();
    const vw = base.width;
    const rects: NoteRect[] = ctl.noteRects().slice(0, MAX_SHARDS);
    const body = logo.current?.getBoundingClientRect();
    const cy = body ? body.top - base.top + body.height * 0.62 : base.height * 0.56;
    const sorted = [...rects].sort((a, b) => a.x - b.x);
    const items = layer.children;
    flights.current = [];
    for (let i = 0; i < items.length; i++) {
      const el = items[i] as HTMLElement;
      const n = sorted[i];
      if (!n) {
        el.style.display = "none";
        continue;
      }
      el.style.display = "block";
      el.style.width = `${n.w.toFixed(1)}px`;
      el.style.height = `${n.h.toFixed(1)}px`;
      el.style.background = n.color;
      const rank = sorted.length > 1 ? i / (sorted.length - 1) : 0.5;
      flights.current.push({
        x0: vw * 0.5 + (rank - 0.5) * vw * 0.42 - n.w / 2,
        y0: cy - n.h / 2,
        x1: n.x - base.left,
        y1: n.y - base.top,
        delay: rnd(i, 2) * 0.3,
        rot: (rnd(i, 5) - 0.5) * 80,
      });
    }
  };

  useSceneProgress(wrap, (p) => {
    const vh = window.innerHeight;

    const calm = ease(seg(p, ...T.calm));
    const merge = ease(seg(p, ...T.merge));
    const resume = ease(seg(p, ...T.resume));
    const burst = seg(p, ...T.burst);

    // reloj de las notas: avanzan con el scroll, se detienen en la pausa y
    // vuelven a correr solo cuando las esquirlas ya son las notas
    clock.current.rate = clamp01(1 - calm) + resume;
    clock.current.notesAlpha = clamp01(1 - calm) + merge;
    clock.current.seconds = SCRUB_BEFORE * ease(seg(p, 0, T.calm[1])) + SCRUB_AFTER * seg(p, T.resume[0], 1);

    // 1 · el texto se despide
    const bye = ease(seg(p, ...T.bye));
    if (text.current) {
      text.current.style.opacity = String(1 - bye);
      text.current.style.transform = `translate3d(0, ${(-44 * bye).toFixed(1)}px, 0)`;
      text.current.style.visibility = bye >= 1 ? "hidden" : "";
    }
    if (cue.current) cue.current.style.opacity = String(1 - seg(p, 0, 0.08));
    if (shade.current) shade.current.style.opacity = String(1 - 0.85 * calm);

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

    // 4 · esquirlas: nacen a lo largo del cuerpo roto y vuelan a su nota
    if (shards.current) {
      const entering = prevBurst.current <= 0 && burst > 0;
      prevBurst.current = burst;
      if (entering) planFlights();
      const show = burst > 0 && merge < 1;
      shards.current.style.visibility = show ? "visible" : "hidden";
      if (show) {
        const items = shards.current.children;
        const fl = flights.current;
        for (let i = 0; i < fl.length; i++) {
          const f = fl[i];
          const el = items[i] as HTMLElement;
          const q = easeOut(seg(burst, f.delay, 1));
          const x = f.x0 + (f.x1 - f.x0) * q;
          const y = f.y0 + (f.y1 - f.y0) * q - Math.sin(q * Math.PI) * vh * 0.12; // arco hacia arriba
          const alpha = Math.min(seg(q, 0, 0.1), 1 - merge);
          el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${(f.rot * (1 - q)).toFixed(1)}deg) scale(${(0.5 + 0.5 * q).toFixed(3)})`;
          el.style.opacity = alpha.toFixed(3);
        }
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
      <div ref={stage} className="scene-stage">
        <div className="hero-bg">
          <HeroDemo speed={0.6} startAt={3} minWidth={1100} offsetRef={clock} controlRef={demo} />
        </div>
        <div ref={shade} className="hero-shade" aria-hidden="true" />
        <SoftBackdrop rain={0} clouds={false} />

        <div ref={shards} className="scene-shards" aria-hidden="true">
          {Array.from({ length: MAX_SHARDS }, (_, i) => (
            <i key={i} />
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
