"use client";

/**
 * Tutorial de notas que caen.
 *
 * Sincronización: el elemento <audio> es el reloj autoritativo. Cada frame
 * (requestAnimationFrame) lee audio.currentTime y pinta el canvas; no existe
 * ningún temporizador propio que pueda derivar.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PianoTranscription } from "@piano/contracts";

import { MediaClock, loadSyncOffsetMs, saveSyncOffsetMs } from "@/lib/clock";
import { getDataSource } from "@/lib/data";
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
  const data = getDataSource();
  const [transcription, setTranscription] = useState<PianoTranscription | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1.0);
  const [displayTime, setDisplayTime] = useState(0);
  const [loopA, setLoopA] = useState<number | null>(null);
  const [loopB, setLoopB] = useState<number | null>(null);
  const [handFilter, setHandFilter] = useState<HandFilter>("both");
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [rotateDismissed, setRotateDismissed] = useState(false);
  const [syncOffsetMs, setSyncOffsetMs] = useState(0);

  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Refs espejo para que el bucle rAF no dependa de re-renders de React.
  const loopRef = useRef<{ a: number | null; b: number | null }>({ a: null, b: null });
  const handFilterRef = useRef<HandFilter>("both");
  const maxDurRef = useRef(0);
  // Reloj suavizado: el <audio> manda, pero se interpola entre sus lecturas.
  const clockRef = useRef(new MediaClock());
  const syncOffsetRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([data.getTranscription(id), data.getAudioUrl(id)])
      .then(([t, url]) => {
        if (cancelled) return;
        maxDurRef.current = maxDuration(t.notes);
        setTranscription(t);
        setAudioSrc(url);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    setMarkers(loadMarkers(id));
    const offset = loadSyncOffsetMs();
    syncOffsetRef.current = offset;
    setSyncOffsetMs(offset);
    return () => {
      cancelled = true;
    };
  }, [id, data]);

  useEffect(() => {
    loopRef.current = { a: loopA, b: loopB };
  }, [loopA, loopB]);

  useEffect(() => {
    handFilterRef.current = handFilter;
  }, [handFilter]);

  // Bucle de render: audio.currentTime -> canvas.
  useEffect(() => {
    if (!transcription || !audioSrc) return;
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

    // Cualquier salto o cambio de velocidad del audio re-ancla el reloj.
    const resetClock = () => clockRef.current.reset();
    for (const ev of ["seeked", "ratechange", "play", "pause"]) {
      audio.addEventListener(ev, resetClock);
    }

    const tick = () => {
      const t = clockRef.current.update({
        mediaTime: audio.currentTime,
        nowMs: performance.now(),
        playbackRate: audio.playbackRate,
        paused: audio.paused,
        seeking: audio.seeking,
      });

      // Loop A/B: al llegar a B se vuelve a A.
      const { a, b } = loopRef.current;
      if (a !== null && b !== null && t >= b) {
        audio.currentTime = a;
        clockRef.current.reset();
      }

      // Ajuste de sincronia: positivo = las notas van "antes" respecto al audio
      // reportado (compensa auriculares Bluetooth, que suenan tarde).
      const renderTime = t + syncOffsetRef.current / 1000;

      drawFrame(ctx, cssWidth, cssHeight, {
        notes: transcription.notes,
        maxNoteDuration: maxDurRef.current,
        currentTime: renderTime,
        loopA: a,
        loopB: b,
        handFilter: handFilterRef.current,
      });
      setDisplayTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      for (const ev of ["seeked", "ratechange", "play", "pause"]) {
        audio.removeEventListener(ev, resetClock);
      }
    };
  }, [transcription, audioSrc]);

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
      // preservesPitch: cambia la velocidad sin cambiar el tono (Safari viejo usa el prefijo).
      audio.preservesPitch = true;
      (audio as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
      audio.playbackRate = rate;
      clockRef.current.reset();
    }
    setSpeed(rate);
  };

  const seek = (t: number) => {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = t;
      clockRef.current.reset();
    }
    setDisplayTime(t);
  };

  const changeSyncOffset = (deltaMs: number) => {
    const next = Math.max(-500, Math.min(500, syncOffsetRef.current + deltaMs));
    syncOffsetRef.current = next;
    setSyncOffsetMs(next);
    saveSyncOffsetMs(next);
  };

  const resetSyncOffset = () => {
    syncOffsetRef.current = 0;
    setSyncOffsetMs(0);
    saveSyncOffsetMs(0);
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
      <div className="message">
        <p>No se pudo cargar el tutorial: {error}</p>
        <Link href="/" className="btn">
          ← Volver a la biblioteca
        </Link>
      </div>
    );
  }
  if (!transcription || !audioSrc) {
    return <div className="message">Cargando transcripción…</div>;
  }

  const duration = transcription.duration;
  const hasHands = transcription.notes.some((n) => n.hand !== null);

  return (
    <div className="tutorial">
      <div ref={containerRef} className="stage">
        <canvas ref={canvasRef} />
        <div className={`rotate-hint${rotateDismissed ? "" : " visible"}`}>
          <div>
            📱↻ Gira el teléfono: en horizontal las 88 teclas se ven mucho mejor.
            <br />
            <button className="btn" onClick={() => setRotateDismissed(true)}>
              Seguir en vertical
            </button>
          </div>
        </div>
      </div>

      <div className="controls">
        <Link href="/" className="back" aria-label="Volver a la biblioteca">
          ←
        </Link>
        <button className="btn" onClick={togglePlay}>
          {isPlaying ? "⏸" : "▶"}
        </button>

        <span className="time">
          {formatTime(displayTime)} / {formatTime(duration)}
        </span>

        <input
          className="seek"
          type="range"
          min={0}
          max={duration}
          step={0.01}
          value={Math.min(displayTime, duration)}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Posición"
        />

        <span className="group" role="group" aria-label="Velocidad">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => changeSpeed(s)}
              className={`btn small${speed === s ? " active" : ""}`}
            >
              {s === 1 ? "1x" : `${s}x`}
            </button>
          ))}
        </span>

        <span className="group" role="group" aria-label="Loop A/B">
          <button className="btn small" onClick={markA}>
            A{loopA !== null ? ` ${formatTime(loopA)}` : ""}
          </button>
          <button className="btn small" onClick={markB} disabled={loopA === null}>
            B{loopB !== null ? ` ${formatTime(loopB)}` : ""}
          </button>
          {(loopA !== null || loopB !== null) && (
            <button className="btn small" onClick={clearLoop} aria-label="Quitar loop">
              ✕
            </button>
          )}
        </span>
      </div>

      <div className="controls">
        {hasHands && (
          <span className="group" role="group" aria-label="Filtro de manos">
            {(
              [
                ["both", "Ambas"],
                ["left", "Izq."],
                ["right", "Der."],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setHandFilter(value)}
                className={`btn small${handFilter === value ? " active" : ""}`}
              >
                {label}
              </button>
            ))}
          </span>
        )}

        <span className="group" role="group" aria-label="Ajuste de sincronía">
          <button
            className="btn small"
            onClick={() => changeSyncOffset(-25)}
            title="Las notas llegan antes que el sonido: retrasarlas"
          >
            −
          </button>
          <button
            className="btn small sync-value"
            onClick={resetSyncOffset}
            title="Ajuste de sincronía (clic para volver a 0). Súbelo si el sonido llega después que las notas, p. ej. con auriculares Bluetooth."
          >
            Sinc. {syncOffsetMs > 0 ? "+" : ""}{syncOffsetMs} ms
          </button>
          <button
            className="btn small"
            onClick={() => changeSyncOffset(25)}
            title="El sonido llega después que las notas: adelantarlas"
          >
            +
          </button>
        </span>

        <span className="group">
          <button className="btn small" onClick={addMarker}>
            ＋ Marcador
          </button>
          {markers.map((m, i) => (
            <span key={`${m.t}-${i}`} className="marker">
              <button className="jump" onClick={() => seek(m.t)}>
                {m.name} {formatTime(m.t)}
              </button>
              <button
                className="remove"
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
        src={audioSrc}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        preload="auto"
      />

      <p className="hint">
        Espacio: reproducir/pausar · A/B: loop de práctica ·{" "}
        {hasHands ? "verde: mano derecha, azul: izquierda · " : ""}
        {transcription.notes.length} notas · {transcription.transcription.engine}
      </p>
    </div>
  );
}
