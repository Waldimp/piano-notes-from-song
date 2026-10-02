"use client";

/**
 * "Del audio a tus manos", contado con el scroll y solo con vectores: una
 * onda de sonido se descompone en puntos, los puntos se ordenan en un
 * pentagrama y por último caen como barras sobre un teclado, que se ilumina
 * al recibirlas. Las mismas 32 partículas SVG viajan por las tres fases.
 *
 * Imperativo por frame sobre refs; el texto del paso sí es estado (discreto).
 */

import { type ReactNode, useRef, useState } from "react";

import { clamp01, ease, seg, useSceneProgress } from "./useSceneProgress";

const W = 600;
const H = 420;
const N = 32;
const WHITE = 21;
const KEY_W = W / WHITE;
const KEY_TOP = 330;
const STAFF_TOP = 108;
const STAFF_GAP = 14;
const MATCHA = "#809671";
const CHAI = "#d2ab80";

const rnd = (i: number, k: number) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const easeIn = (t: number) => t * t * t;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type P = {
  waveX: number;
  waveH: number;
  staffX: number;
  staffY: number;
  lane: number;
  barH: number;
  delay: number;
  color: string;
};

const PARTS: P[] = Array.from({ length: N }, (_, i) => {
  const t = i / (N - 1);
  const waveH = 14 + (0.5 + 0.5 * Math.sin(i * 0.9)) * 60 + rnd(i, 1) * 50;
  return {
    waveX: 40 + t * (W - 80),
    waveH,
    staffX: 70 + t * (W - 140),
    staffY: STAFF_TOP + Math.round(rnd(i, 2) * 8) * (STAFF_GAP / 2),
    lane: Math.max(0, Math.min(WHITE - 1, Math.round(t * (WHITE - 1) + (rnd(i, 3) - 0.5) * 2))),
    barH: 34 + rnd(i, 4) * 56,
    delay: rnd(i, 5),
    color: rnd(i, 6) > 0.45 ? MATCHA : CHAI,
  };
});

/** Teclas negras del patrón de la octava, empezando en C. */
const BLACK_AFTER = new Set([0, 1, 3, 4, 5]);

type Step = { eyebrow: string; title: ReactNode; text: string };
const STEPS: Step[] = [
  {
    eyebrow: "Sube",
    title: (
      <>
        Una grabación <span className="script">de piano</span>
      </>
    ),
    text: "MP3, WAV, M4A, FLAC u OGG. Un cover que te guste, una clase, tu propia toma.",
  },
  {
    eyebrow: "Escuchamos",
    title: (
      <>
        La IA detecta <span className="script">cada nota</span>
      </>
    ),
    text: "Altura, duración, intensidad y pedal, con un modelo entrenado solo en piano.",
  },
  {
    eyebrow: "Practicas",
    title: (
      <>
        Notas que caen sobre <span className="script">88 teclas</span>
      </>
    ),
    text: "Ves qué tecla, cuándo y cuánto. Y el tutorial espera tu ritmo, no al revés.",
  },
];

export default function FlowScene() {
  const wrap = useRef<HTMLElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const dots = useRef<HTMLOListElement>(null);
  const [step, setStep] = useState(0);
  const stepRef = useRef(0);

  useSceneProgress(wrap, (p) => {
    const next = Math.min(STEPS.length - 1, Math.floor(p * STEPS.length));
    if (next !== stepRef.current) {
      stepRef.current = next;
      setStep(next);
    }
    dots.current?.querySelectorAll<HTMLElement>("i").forEach((bar, i) => bar.style.setProperty("--p", clamp01(p * STEPS.length - i).toFixed(3)));

    const root = svg.current;
    if (!root) return;
    const parts = root.querySelectorAll<SVGRectElement>("rect.fp");
    const stems = root.querySelectorAll<SVGLineElement>("line.fs");
    const staff = root.querySelector<SVGGElement>("g.staff");
    const keyboard = root.querySelector<SVGGElement>("g.keys");
    const lit = root.querySelectorAll<SVGRectElement>("rect.lit");
    const baseline = root.querySelector<SVGLineElement>("line.wave-axis");

    const staffIn = ease(seg(p, 0.3, 0.46));
    const staffOut = ease(seg(p, 0.7, 0.86));
    if (staff) {
      staff.style.opacity = String(staffIn * (1 - staffOut));
      staff.querySelectorAll<SVGLineElement>("line").forEach((l, i) => {
        l.style.strokeDashoffset = String(W * (1 - ease(seg(p, 0.28 + i * 0.02, 0.44 + i * 0.02))));
      });
    }
    if (baseline) baseline.style.opacity = String(0.5 * (1 - ease(seg(p, 0.24, 0.4))));
    const kbIn = ease(seg(p, 0.54, 0.68));
    if (keyboard) {
      keyboard.style.opacity = String(kbIn);
      keyboard.style.transform = `translateY(${(26 * (1 - kbIn)).toFixed(1)}px)`;
    }
    const litAmount = new Array<number>(WHITE).fill(0);

    for (let i = 0; i < N; i++) {
      const s = PARTS[i];
      const el = parts[i];
      if (!el) continue;
      // fase 1 → 2: la barra de la onda se encoge a un punto y vuela al pentagrama
      const q1 = ease(seg(p, 0.26 + s.delay * 0.12, 0.46 + s.delay * 0.12));
      // fase 2 → 3: el punto baja como barra a su tecla
      const q2 = easeIn(seg(p, 0.58 + s.delay * 0.22, 0.8 + s.delay * 0.22));
      const laneX = (s.lane + 0.5) * KEY_W;

      // la onda respira un poco con el scroll antes de romperse
      const breathe = 1 + 0.18 * Math.sin(p * 40 + i);
      const waveH = s.waveH * breathe;
      let w = lerp(8, 12, q1);
      let h = lerp(waveH, 9, q1);
      let cx = lerp(s.waveX, s.staffX, q1);
      let cy = lerp(210, s.staffY, q1);
      let rot = lerp(0, -20, q1);
      if (q2 > 0) {
        w = lerp(12, 18, q2);
        h = lerp(9, s.barH, q2);
        cx = lerp(s.staffX, laneX, q2);
        const targetCy = KEY_TOP - s.barH / 2;
        cy = lerp(s.staffY, targetCy, q2);
        rot = lerp(-20, 0, q2);
      }
      el.setAttribute("x", (cx - w / 2).toFixed(1));
      el.setAttribute("y", (cy - h / 2).toFixed(1));
      el.setAttribute("width", w.toFixed(1));
      el.setAttribute("height", h.toFixed(1));
      el.setAttribute("rx", Math.min(6, w / 2).toFixed(1));
      el.setAttribute("transform", `rotate(${rot.toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})`);
      const stem = stems[i];
      if (stem) {
        const alpha = q1 * (1 - ease(seg(q2, 0, 0.35)));
        stem.style.opacity = alpha.toFixed(3);
        const sx = cx + 5;
        stem.setAttribute("x1", sx.toFixed(1));
        stem.setAttribute("x2", sx.toFixed(1));
        stem.setAttribute("y1", (cy - 2).toFixed(1));
        stem.setAttribute("y2", (cy - 34).toFixed(1));
      }
      if (q2 > 0.92) litAmount[s.lane] = Math.max(litAmount[s.lane], seg(q2, 0.92, 1));
    }
    lit.forEach((k, lane) => {
      k.style.opacity = (litAmount[lane] * 0.9).toFixed(3);
    });
  });

  return (
    <section ref={wrap} className="section scene-flow" aria-labelledby="how-title">
      <div className="scene-stage tut-stage">
        <div className="section-inner tut-grid">
          <div className="tut-copy">
            <p className="eyebrow flow-kicker">De un audio a tus manos</p>
            {STEPS.map((st, i) => (
              <div key={st.eyebrow} className={`tut-step section-head${i === step ? " on" : i < step ? " past" : ""}`} aria-hidden={i !== step}>
                <p className="eyebrow">
                  <span className="n">{i + 1}</span> {st.eyebrow}
                </p>
                <h2 id={i === 0 ? "how-title" : undefined}>{st.title}</h2>
                <p>{st.text}</p>
              </div>
            ))}
            <ol ref={dots} className="tut-dots" aria-hidden="true">
              {STEPS.map((st, i) => (
                <li key={st.eyebrow} className={i === step ? "on" : ""}>
                  <i />
                </li>
              ))}
            </ol>
          </div>

          <div className="flow-art">
            <svg ref={svg} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
              <line className="wave-axis" x1="30" y1="210" x2={W - 30} y2="210" stroke="#725c3a" strokeWidth="1" strokeDasharray="2 5" />
              <g className="staff">
                {[0, 1, 2, 3, 4].map((i) => (
                  <line
                    key={i}
                    x1="50"
                    x2={W - 50}
                    y1={STAFF_TOP + i * STAFF_GAP}
                    y2={STAFF_TOP + i * STAFF_GAP}
                    stroke="#725c3a"
                    strokeWidth="1.2"
                    strokeDasharray={W}
                    strokeDashoffset={W}
                    opacity="0.55"
                  />
                ))}
              </g>
              <g className="keys">
                {Array.from({ length: WHITE }, (_, i) => (
                  <rect key={`w${i}`} x={i * KEY_W + 0.5} y={KEY_TOP} width={KEY_W - 1} height={H - KEY_TOP} rx="3" fill="#fffdf8" stroke="#d8cdb9" strokeWidth="1" />
                ))}
                {Array.from({ length: WHITE }, (_, i) => (
                  <rect key={`l${i}`} className="lit" x={i * KEY_W + 0.5} y={KEY_TOP} width={KEY_W - 1} height={H - KEY_TOP} rx="3" fill={PARTS.find((q) => q.lane === i)?.color ?? MATCHA} opacity="0" />
                ))}
                {Array.from({ length: WHITE - 1 }, (_, i) =>
                  BLACK_AFTER.has(i % 7) ? (
                    <rect key={`b${i}`} x={(i + 1) * KEY_W - KEY_W * 0.3} y={KEY_TOP} width={KEY_W * 0.6} height={(H - KEY_TOP) * 0.6} rx="2" fill="#725c3a" />
                  ) : null,
                )}
                <line x1="0" y1={KEY_TOP} x2={W} y2={KEY_TOP} stroke="#b3b792" strokeWidth="3" />
              </g>
              {PARTS.map((s, i) => (
                <line key={`s${i}`} className="fs" stroke="#725c3a" strokeWidth="1.6" strokeLinecap="round" opacity="0" />
              ))}
              {PARTS.map((s, i) => (
                <rect key={`p${i}`} className="fp" fill={s.color} />
              ))}
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
