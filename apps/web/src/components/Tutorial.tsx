"use client";

/**
 * Tutorial de notas que caen.
 *
 * Sincronización: el elemento <audio> es el reloj autoritativo. Cada frame
 * (requestAnimationFrame) lee audio.currentTime y pinta el canvas; no existe
 * ningún temporizador propio que pueda derivar.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PianoTranscription } from "@piano/contracts";

import { audioUrl, fetchNotes } from "@/lib/api";
import { maxDuration } from "@/lib/falling";
import { type HandFilter, drawFrame } from "@/lib/renderer";

const SPEEDS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5] as const;

interface Marker {
  name: string;
  t: number;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Marcadores por canción en localStorage (conveniencia local del navegador). */
function loadMarkers(id: string): Marker[] {
  try {
    const raw = localStorage.getItem(`piano:markers:${id}`);
    return raw ? (JSON.parse(raw) as Marker[]) : [];
  } catch {
    return [];
  }
}

function saveMarkers(id: string, markers: Marker[]): void {
  try {
    localStorage.setItem(`piano:markers:${id}`, JSON.stringify(markers));
  } catch {
    // sin almacenamiento disponible: los marcadores viven solo en la sesión
  }
}

export default function Tutorial({ id }: { id: string }) {
  const [transcription, setTranscription] = useState<PianoTranscription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1.0);
  const [displayTime, setDisplayTime] = useState(0);
  const [loopA, setLoopA] = useState<number | null>(null);
  const [loopB, setLoopB] = useState<number | null>(null);
  const [handFilter, setHandFilter] = useState<HandFilter>("both");
  const [markers, setMarkers] = useState<Marker[]>([]);

  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Refs espejo para que el bucle rAF no dependa de re-renders de React.
  const loopRef = useRef<{ a: number | null; b: number | null }>({ a: null, b: null });
  const handFilterRef = useRef<HandFilter>("both");
  const maxDurRef = useRef(0);

  useEffect(() => {
    fetchNotes(id)
      .then((t) => {
        maxDurRef.current = maxDuration(t.notes);
        setTranscription(t);
      })
      .catch((e: Error) => setError(e.message));
    setMarkers(loadMarkers(id));
  }, [id]);

  useEffect(() => {
    loopRef.current = { a: loopA, b: loopB };
  }, [loopA, loopB]);

  useEffect(() => {
    handFilterRef.current = handFilter;
  }, [handFilter]);

  // Bucle de render: audio.currentTime -> canvas.
  useEffect(() => {
    if (!transcription) return;
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    const container = containerRef.current;
    if (!canvas || !audio || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let cssWidth = 0;
    let cssHeight = 0;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      cssWidth = rect.width;
      cssHeight = rect.height;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    const tick = () => {
      const t = audio.currentTime;

      // Loop A/B: al llegar a B se vuelve a A.
      const { a, b } = loopRef.current;
      if (a !== null && b !== null && t >= b) {
        audio.currentTime = a;
      }

      drawFrame(ctx, cssWidth, cssHeight, {
        notes: transcription.notes,
        maxNoteDuration: maxDurRef.current,
        currentTime: audio.currentTime,
        loopA: a,
        loopB: b,
        handFilter: handFilterRef.current,
      });
      setDisplayTime(audio.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [transcription]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  }, []);

  // Barra espaciadora = play/pausa.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && e.target === document.body) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay]);

  const changeSpeed = (rate: number) => {
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = rate;
      audio.preservesPitch = true;
    }
    setSpeed(rate);
  };

  const seek = (t: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = t;
    setDisplayTime(t);
  };

  const markA = () => {
    const t = audioRef.current?.currentTime ?? 0;
    setLoopA(t);
    if (loopB !== null && loopB <= t) setLoopB(null);
  };
  const markB = () => {
    const t = audioRef.current?.currentTime ?? 0;
    if (loopA !== null && t > loopA) setLoopB(t);
  };
  const clearLoop = () => {
    setLoopA(null);
    setLoopB(null);
  };

  const addMarker = () => {
    const t = audioRef.current?.currentTime ?? 0;
    const next = [...markers, { name: `M${markers.length + 1}`, t }].sort(
      (a, b) => a.t - b.t,
    );
    setMarkers(next);
    saveMarkers(id, next);
  };

  const removeMarker = (index: number) => {
    const next = markers.filter((_, i) => i !== index);
    setMarkers(next);
    saveMarkers(id, next);
  };

  if (error) {
    return (
      <div style={styles.message}>
        <p>No se pudo cargar el tutorial: {error}</p>
        <p>¿Está corriendo el backend? (uvicorn en el puerto 8010)</p>
      </div>
    );
  }
  if (!transcription) {
    return <div style={styles.message}>Cargando transcripción…</div>;
  }

  const duration = transcription.duration;
  const hasHands = transcription.notes.some((n) => n.hand !== null);

  return (
    <div style={styles.page}>
      <div ref={containerRef} style={styles.canvasContainer}>
        <canvas ref={canvasRef} />
      </div>

      <div style={styles.controls}>
        <button style={styles.button} onClick={togglePlay}>
          {isPlaying ? "⏸ Pausa" : "▶ Reproducir"}
        </button>

        <span style={styles.time}>
          {formatTime(displayTime)} / {formatTime(duration)}
        </span>

        <input
          type="range"
          min={0}
          max={duration}
          step={0.01}
          value={Math.min(displayTime, duration)}
          onChange={(e) => seek(Number(e.target.value))}
          style={styles.seek}
          aria-label="Posición"
        />

        <span style={styles.group}>
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => changeSpeed(s)}
              style={{ ...styles.button, ...(speed === s ? styles.buttonActive : {}) }}
            >
              {s.toFixed(2)}x
            </button>
          ))}
        </span>

        <span style={styles.group}>
          <button style={styles.button} onClick={markA}>
            A {loopA !== null ? `= ${formatTime(loopA)}` : ""}
          </button>
          <button style={styles.button} onClick={markB} disabled={loopA === null}>
            B {loopB !== null ? `= ${formatTime(loopB)}` : ""}
          </button>
          {(loopA !== null || loopB !== null) && (
            <button style={styles.button} onClick={clearLoop}>
              ✕ Loop
            </button>
          )}
        </span>
      </div>

      <div style={styles.controls}>
        {hasHands && (
          <span style={styles.group} role="group" aria-label="Filtro de manos">
            {(
              [
                ["both", "Ambas manos"],
                ["left", "Izquierda"],
                ["right", "Derecha"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setHandFilter(value)}
                style={{
                  ...styles.button,
                  ...(handFilter === value ? styles.buttonActive : {}),
                  ...(value === "left" ? styles.leftHint : {}),
                }}
              >
                {label}
              </button>
            ))}
          </span>
        )}

        <span style={styles.group}>
          <button style={styles.button} onClick={addMarker}>
            ＋ Marcador
          </button>
          {markers.map((m, i) => (
            <span key={`${m.t}-${i}`} style={styles.marker}>
              <button style={styles.markerJump} onClick={() => seek(m.t)}>
                {m.name} {formatTime(m.t)}
              </button>
              <button
                style={styles.markerRemove}
                onClick={() => removeMarker(i)}
                aria-label={`Eliminar marcador ${m.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </span>
      </div>

      <audio
        ref={audioRef}
        src={audioUrl(id)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        preload="auto"
      />

      <p style={styles.hint}>
        Espacio: reproducir/pausar · A/B: loop de práctica ·{" "}
        {hasHands ? "verde: mano derecha, azul: izquierda · " : ""}
        {transcription.notes.length} notas · engine: {transcription.transcription.engine}
      </p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    background: "#0e0e14",
    color: "#e8e6e0",
  },
  canvasContainer: { flex: 1, minHeight: 0 },
  controls: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.45rem 1rem",
    flexWrap: "wrap",
    borderTop: "1px solid #26262f",
  },
  button: {
    background: "#23232e",
    color: "#e8e6e0",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#3a3a46",
    borderRadius: 6,
    padding: "0.4rem 0.8rem",
    cursor: "pointer",
    fontSize: "0.9rem",
  },
  buttonActive: { background: "#4caf60", borderColor: "#4caf60", color: "#0e0e14" },
  leftHint: {},
  time: { fontVariantNumeric: "tabular-nums", fontSize: "0.9rem" },
  seek: { flex: 1, minWidth: 180 },
  group: { display: "inline-flex", gap: "0.35rem", flexWrap: "wrap", alignItems: "center" },
  marker: { display: "inline-flex", alignItems: "stretch" },
  markerJump: {
    background: "#1c2a36",
    color: "#7cbde8",
    border: "1px solid #2e4a60",
    borderRight: "none",
    borderRadius: "6px 0 0 6px",
    padding: "0.3rem 0.55rem",
    cursor: "pointer",
    fontSize: "0.82rem",
  },
  markerRemove: {
    background: "#1c2a36",
    color: "#8b8b98",
    border: "1px solid #2e4a60",
    borderRadius: "0 6px 6px 0",
    padding: "0.3rem 0.45rem",
    cursor: "pointer",
    fontSize: "0.82rem",
  },
  message: { padding: "2rem", color: "#e8e6e0", background: "#0e0e14", minHeight: "100vh" },
  hint: { margin: 0, padding: "0 1rem 0.75rem", fontSize: "0.78rem", color: "#8b8b98" },
};
