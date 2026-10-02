"use client";

/**
 * "Así se practica", contado con el scroll: el reproductor real queda fijo
 * y cada tramo de desplazamiento acciona un control (velocidad, loop A·B,
 * manos) mientras el texto del paso aparece al lado. Los chips siguen
 * siendo reales: tocarlos manda hasta que el scroll cambie de paso.
 */

import { type ReactNode, useEffect, useRef, useState } from "react";

import HeroDemo from "@/components/HeroDemo";
import type { HandFilter } from "@/lib/renderer";
import { clamp01, useSceneProgress } from "./useSceneProgress";

const SPEEDS = [0.5, 0.75, 1] as const;
const LOOP: [number, number] = [8, 14];

type Step = {
  eyebrow: string;
  title: ReactNode;
  text: string;
  speed: number;
  loop: boolean;
  hand: HandFilter;
};

const STEPS: Step[] = [
  {
    eyebrow: "Así se practica",
    title: (
      <>
        Tócalo con los <span className="script">controles de verdad</span>
      </>
    ),
    text: "Lo que ves es el reproductor real de Pianissimo con una transcripción real. Sigue bajando y mira cómo cambia.",
    speed: 1,
    loop: false,
    hand: "both",
  },
  {
    eyebrow: "Velocidad",
    title: (
      <>
        Despacio <span className="script">primero</span>
      </>
    ),
    text: "A 0.5x las notas se alargan y te dan tiempo de ver cada tecla. El tono no cambia: el audio original sigue siendo el reloj.",
    speed: 0.5,
    loop: false,
    hand: "both",
  },
  {
    eyebrow: "Loop A · B",
    title: (
      <>
        Repite el pasaje <span className="script">difícil</span>
      </>
    ),
    text: "Marca un inicio y un final y el tutorial vuelve solo. La banda te muestra exactamente qué compases estás repitiendo.",
    speed: 0.75,
    loop: true,
    hand: "both",
  },
  {
    eyebrow: "Manos",
    title: (
      <>
        Una mano <span className="script">a la vez</span>
      </>
    ),
    text: "Apaga la izquierda y estudia la derecha sola, o al revés. Matcha para la derecha, chai para la izquierda.",
    speed: 0.75,
    loop: true,
    hand: "right",
  },
];

type Override = Partial<Pick<Step, "speed" | "loop" | "hand">>;

export default function TutorialScene() {
  const wrap = useRef<HTMLElement>(null);
  const dots = useRef<HTMLOListElement>(null);
  const [step, setStep] = useState(0);
  const [override, setOverride] = useState<Override>({});
  const stepRef = useRef(0);

  useSceneProgress(wrap, (p) => {
    const next = Math.min(STEPS.length - 1, Math.floor(p * STEPS.length));
    if (next !== stepRef.current) {
      stepRef.current = next;
      setStep(next);
    }
    const bars = dots.current?.querySelectorAll<HTMLElement>("i");
    bars?.forEach((bar, i) => bar.style.setProperty("--p", clamp01(p * STEPS.length - i).toFixed(3)));
  });

  // Al cambiar de paso con el scroll, los controles vuelven a lo que dicta el paso.
  useEffect(() => setOverride({}), [step]);

  const s = STEPS[step];
  const speed = override.speed ?? s.speed;
  const loop = override.loop ?? s.loop;
  const hand = override.hand ?? s.hand;

  return (
    <section ref={wrap} className="section scene-tutorial" id="demo" aria-labelledby="demo-title">
      <div className="scene-stage tut-stage">
        <div className="section-inner tut-grid">
          <div className="tut-copy">
            {STEPS.map((st, i) => (
              <div key={st.eyebrow} className={`tut-step section-head${i === step ? " on" : i < step ? " past" : ""}`} aria-hidden={i !== step}>
                <p className="eyebrow">{st.eyebrow}</p>
                <h2 id={i === 0 ? "demo-title" : undefined}>{st.title}</h2>
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

          <div className="tut-demo">
            <div className="stage-demo single">
              <HeroDemo speed={speed} loop={loop ? LOOP : null} handFilter={hand} startAt={6} minWidth={720} showNames />
            </div>
            <div className="tut-chips">
              <div className="chips" role="group" aria-label="Velocidad de la demo">
                {SPEEDS.map((v) => (
                  <button key={v} type="button" className="chip" aria-pressed={speed === v} onClick={() => setOverride((o) => ({ ...o, speed: v }))}>
                    {v}x
                  </button>
                ))}
              </div>
              <div className="chips">
                <button type="button" className="chip" aria-pressed={loop} onClick={() => setOverride((o) => ({ ...o, loop: !loop }))}>
                  {loop ? "Repitiendo 0:08 → 0:14" : "Repetir A → B"}
                </button>
              </div>
              <div className="chips" role="group" aria-label="Manos">
                {(
                  [
                    ["both", "Ambas"],
                    ["left", "Izquierda"],
                    ["right", "Derecha"],
                  ] as const
                ).map(([v, label]) => (
                  <button key={v} type="button" className="chip" aria-pressed={hand === v} onClick={() => setOverride((o) => ({ ...o, hand: v }))}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
