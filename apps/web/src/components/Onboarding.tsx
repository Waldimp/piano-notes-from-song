"use client";

/**
 * Bienvenida en cuatro pantallas (inspo de Melanie): Pianissimo → Encuentra
 * tu estilo → Sube tu archivo → Practica y disfruta. Toca o desliza para
 * avanzar; los estilos elegidos se guardan en el navegador y aparecen en la
 * biblioteca. Todo CSS: sin estado de React por frame.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/AuthGate";
import SoftBackdrop from "@/components/soft/SoftBackdrop";
import { CloudUpload, GrandPiano, Ribbon, Sprout, TrebleClef } from "@/components/soft/Illustrations";
import { GENRES, loadStyles, markOnboarded, saveStyles } from "@/lib/prefs";

const LIT: Array<[number, "m" | "c"]> = [
  [5, "m"],
  [9, "c"],
  [14, "m"],
  [19, "m"],
  [23, "c"],
];
const BLACK = new Set([1, 2, 4, 5, 6, 8, 9, 11, 12, 13, 15, 16, 18, 19, 20, 22, 23]);

function PianoStrip() {
  return (
    <div className="ob-piano" aria-hidden="true">
      <div className="ob-keys">
        {Array.from({ length: 26 }, (_, i) => {
          const lit = LIT.find(([k]) => k === i);
          return <i key={i} className={`${BLACK.has(i) ? "b" : ""}${lit ? ` lit ${lit[1]}` : ""}`} />;
        })}
      </div>
    </div>
  );
}

export default function Onboarding() {
  const router = useRouter();
  const { email } = useAuth();
  const [step, setStep] = useState(0);
  const [styles, setStyles] = useState<string[]>([]);
  const touchX = useRef<number | null>(null);
  const LAST = 3;

  useEffect(() => {
    setStyles(loadStyles());
  }, []);

  const finish = useCallback(() => {
    markOnboarded();
    router.push(email ? "/" : "/login");
  }, [router, email]);

  const next = useCallback(() => {
    if (step >= LAST) finish();
    else setStep((s) => s + 1);
  }, [step, finish]);
  const prev = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  const toggleStyle = (g: string) => {
    const nextStyles = styles.includes(g) ? styles.filter((x) => x !== g) : [...styles, g];
    setStyles(nextStyles);
    saveStyles(nextStyles);
  };

  const cls = (i: number) => `ob-screen${i === step ? " active" : i < step ? " left" : ""}`;

  return (
    <main
      className="ob"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button, a")) return;
        next();
      }}
      onTouchStart={(e) => {
        touchX.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (dx < -50) next();
        else if (dx > 50) prev();
      }}
      aria-label="Bienvenida a Pianissimo"
    >
      <SoftBackdrop rain={step === 0 || step === 3 ? 1 : 0.4} clouds={step === 0 || step === 3} />
      <div className="ob-dots" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <i key={i} className={i === step ? "on" : ""} />
        ))}
      </div>
      <button type="button" className="btn ghost small ob-skip" onClick={finish}>
        Saltar
      </button>

      {/* 1 · Pianissimo */}
      <section className={cls(0)} aria-hidden={step !== 0}>
        <GrandPiano className="ob-art" />
        <h1 className="ob-title">
          Pianissimo <TrebleClef className="clef-inline" />
        </h1>
        <p className="ob-text">Tu canción favorita, convertida en un tutorial para tus manos.</p>
        <PianoStrip />
      </section>

      {/* 2 · Encuentra tu estilo */}
      <section className={cls(1)} aria-hidden={step !== 1}>
        <div className="ribbons" aria-hidden="true">
          <Ribbon tone="p" className="r1" />
          <Ribbon tone="c" className="r2" />
          <Ribbon tone="m" className="r3" />
        </div>
        <h2 className="ob-title">
          <span className="plain">Encuentra</span>tu estilo
        </h2>
        <p className="ob-text">Elige lo que te gusta tocar. Lo usaremos para acompañarte en tu biblioteca.</p>
        <div className="genre-cloud" role="group" aria-label="Estilos musicales" style={{ marginTop: "1.4rem" }}>
          {GENRES.map((g, i) => (
            <button
              key={g.id}
              type="button"
              className={`genre ${g.tone}`}
              style={{ ["--d" as string]: `${(i % 5) * 0.4}s` }}
              aria-pressed={styles.includes(g.id)}
              onClick={() => toggleStyle(g.id)}
            >
              {g.label}
            </button>
          ))}
        </div>
      </section>

      {/* 3 · Sube tu archivo */}
      <section className={cls(2)} aria-hidden={step !== 2}>
        <CloudUpload className="ob-art" />
        <h2 className="ob-title">
          <span className="plain">Sube</span>tu archivo
        </h2>
        <p className="ob-text">MP3, WAV, M4A, FLAC u OGG. Un cover, una clase, tu propia grabación de piano.</p>
      </section>

      {/* 4 · Practica y disfruta */}
      <section className={cls(3)} aria-hidden={step !== 3}>
        <h2 className="ob-title">
          Practica
          <br />y disfruta
        </h2>
        <Sprout className="sprout-inline" />
        <p className="ob-text">Notas que caen sobre 88 teclas, a tu velocidad, en loop y mano por mano.</p>
        <PianoStrip />
      </section>

      <p className="ob-caption" aria-hidden="true">
        {step === 0 ? "Toca para comenzar" : step === 1 ? "Toca para continuar" : step === 2 ? "Sube tu archivo" : "Toca para comenzar"}
        <i />
      </p>
    </main>
  );
}
