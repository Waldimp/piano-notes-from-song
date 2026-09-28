"use client";

/**
 * "Así se practica": la misma demo del hero pero con los controles reales del
 * producto (velocidad, loop A/B, manos) actuando sobre el lienzo. Show,
 * don't tell: cada chip cambia lo que se ve.
 */

import { useState } from "react";

import HeroDemo from "@/components/HeroDemo";
import type { HandFilter } from "@/lib/renderer";

const SPEEDS = [0.5, 0.75, 1] as const;
const LOOP: [number, number] = [8, 14];

export default function LandingDemo() {
  const [speed, setSpeed] = useState<number>(0.75);
  const [loop, setLoop] = useState(false);
  const [hand, setHand] = useState<HandFilter>("both");

  return (
    <div className="stage-demo">
      <HeroDemo speed={speed} loop={loop ? LOOP : null} handFilter={hand} startAt={6} minWidth={720} showNames />
      <div className="stage-panel">
        <div>
          <p className="chip-label">Velocidad</p>
          <div className="chips" role="group" aria-label="Velocidad de la demo">
            {SPEEDS.map((s) => (
              <button key={s} type="button" className="chip" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                {s}x
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="chip-label">Loop de práctica</p>
          <div className="chips">
            <button type="button" className="chip" aria-pressed={loop} onClick={() => setLoop((v) => !v)}>
              {loop ? "Repitiendo 0:08 → 0:14" : "Repetir un pasaje (A → B)"}
            </button>
          </div>
        </div>
        <div>
          <p className="chip-label">Manos</p>
          <div className="chips" role="group" aria-label="Manos">
            {(
              [
                ["both", "Ambas"],
                ["left", "Izquierda"],
                ["right", "Derecha"],
              ] as const
            ).map(([v, label]) => (
              <button key={v} type="button" className="chip" aria-pressed={hand === v} onClick={() => setHand(v)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <p>
          Lo que ves es el reproductor real de Pianissimo con una transcripción real. Dorado: mano derecha. Azul:
          mano izquierda.
        </p>
      </div>
    </div>
  );
}
