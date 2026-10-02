"use client";

/**
 * Escena de apertura de la landing, contada con el scroll (vectores, no
 * fotogramas): el logo se despide del texto, baja al centro, la tapa se abre
 * y el cuerpo se estira hasta disolverse en el teclado real de 88 teclas,
 * cuyas notas caen al ritmo del desplazamiento. Al final, un remate con CTA.
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
import { ease, seg, useSceneProgress } from "./useSceneProgress";

/** Segundos de demo que avanzan las notas a lo largo de toda la escena. */
const SCRUB_SECONDS = 16;

export default function HeroScene() {
  const wrap = useRef<HTMLElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const logo = useRef<HTMLDivElement>(null);
  const kb = useRef<HTMLDivElement>(null);
  const shade = useRef<HTMLDivElement>(null);
  const tag = useRef<HTMLDivElement>(null);
  const cue = useRef<HTMLDivElement>(null);
  const offset = useRef({ seconds: 0 });

  useSceneProgress(wrap, (p) => {
    const vh = window.innerHeight;
    offset.current.seconds = p * SCRUB_SECONDS;

    // 1 · el texto se despide
    const bye = ease(seg(p, 0, 0.26));
    if (text.current) {
      text.current.style.opacity = String(1 - bye);
      text.current.style.transform = `translate3d(0, ${(-44 * bye).toFixed(1)}px, 0)`;
      text.current.style.visibility = bye >= 1 ? "hidden" : "";
    }
    if (cue.current) cue.current.style.opacity = String(1 - seg(p, 0, 0.08));

    // 2 · el logo baja al centro y crece; la tapa se abre; el cuerpo se estira y se disuelve
    const center = ease(seg(p, 0.04, 0.4));
    const open = ease(seg(p, 0.3, 0.58));
    const gone = ease(seg(p, 0.5, 0.68));
    if (logo.current) {
      const el = logo.current;
      el.style.transform = `translate3d(0, ${(vh * 0.24 * center).toFixed(1)}px, 0) scale(${(1 + 0.95 * center).toFixed(4)})`;
      el.style.opacity = String(1 - gone);
      el.style.visibility = gone >= 1 ? "hidden" : "";
      const lid = el.querySelector<SVGPathElement>(".logo-lid");
      const body = el.querySelector<SVGPathElement>(".logo-body");
      if (lid) {
        lid.style.transform = `rotate(${(-28 * open).toFixed(2)}deg) translate(${(-8 * open).toFixed(1)}px, ${(-12 * open).toFixed(1)}px)`;
        lid.style.opacity = String(1 - ease(seg(p, 0.52, 0.64)));
      }
      if (body) body.style.transform = `scale(${(1 + 1.8 * gone).toFixed(4)}, ${(1 - 0.4 * gone).toFixed(4)})`;
    }

    // 3 · el teclado real toma la escena
    const k = ease(seg(p, 0.34, 0.7));
    if (shade.current) shade.current.style.opacity = String(1 - 0.92 * k);
    if (kb.current) kb.current.style.transform = `translate3d(0, ${(vh * 0.07 * (1 - k)).toFixed(1)}px, 0) scale(${(1.06 - 0.06 * k).toFixed(4)})`;

    // 4 · remate
    const t = ease(seg(p, 0.74, 0.9));
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
          <HeroDemo speed={0.6} startAt={3} minWidth={1100} offsetRef={offset} />
        </div>
        <div ref={shade} className="hero-shade" aria-hidden="true" />
        <SoftBackdrop rain={0} clouds={false} />

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
