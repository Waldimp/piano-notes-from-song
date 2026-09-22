"use client";

/**
 * Tutorial de notas que caen.
 *
 * Sincronización: el elemento <audio> es el reloj autoritativo. Cada frame
 * (requestAnimationFrame) lee audio.currentTime vía MediaClock y pinta el canvas.
 * React sólo se actualiza para la UI (tiempo/controles), no a 60 fps.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PianoTranscription } from "@piano/contracts";

import { MediaClock, loadSyncOffsetMs, saveSyncOffsetMs } from "@/lib/clock";
import { getDataSource } from "@/lib/data";
import { maxDuration } from "@/lib/falling";
import {
  PLAYBACK_SPEEDS,
  SEEK_STEP_SECONDS,
  coerceSeekIntoLoop,
  loopWrapTarget,
  nudgeTime,
  resetPlaybackTime,
} from "@/lib/playback";
import { DEFAULT_VIEW_OPTIONS, type HandFilter, type ViewOptions, drawFrame } from "@/lib/renderer";

const VIEW_KEY = "piano:viewOptions";
/** Opciones del selector "Duración": real, o recorte a N segundos. */
const DURATION_CAPS: Array<{ label: string; value: number | null }> = [
  { label: "Real", value: null },
  { label: "1.5 s", value: 1.5 },
  { label: "0.8 s", value: 0.8 },
];

function loadViewOptions(): ViewOptions {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    return raw ? { ...DEFAULT_VIEW_OPTIONS, ...(JSON.parse(raw) as Partial<ViewOptions>) } : DEFAULT_VIEW_OPTIONS;
  } catch {
    return DEFAULT_VIEW_OPTIONS;
  }
}

function saveViewOptions(v: ViewOptions): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    /* sesión only */
  }
}

interface Marker {
  name: string;
  t: number;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

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
    /* sesión only */
  }
}

function friendlyLoadError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("not found") || lower.includes("no encontrada")) {
    return "No encontramos el tutorial de esta canción. Puede que aún se esté procesando o que falte un archivo.";
  }
  if (lower.includes("notes.json") || lower.includes("contrato")) {
    return "Los datos del tutorial están incompletos o dañados. Prueba a volver a la biblioteca.";
  }
  if (lower.includes("audio") || lower.includes("signed")) {
    return "No pudimos cargar el audio. Revisa tu conexión e inténtalo de nuevo.";
  }
  if (lower.includes("storage") || lower.includes("supabase") || lower.includes("rpc")) {
    return "No pudimos cargar el tutorial. Inténtalo de nuevo en un momento.";
  }
  if (raw.length > 160 || lower.includes("stack")) {
    return "No pudimos cargar el tutorial. Inténtalo de nuevo.";
  }
  return raw;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export default function Tutorial({ id }: { id: string }) {
  const data = getDataSource();
  const [transcription, setTranscription] = useState<PianoTranscription | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1.0);
  const [displayTime, setDisplayTime] = useState(0);
  const [loopA, setLoopA] = useState<number | null>(null);
  const [loopB, setLoopB] = useState<number | null>(null);
  const [loopArmed, setLoopArmed] = useState(false);
  const [handFilter, setHandFilter] = useState<HandFilter>("both");
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [rotateDismissed, setRotateDismissed] = useState(false);
  const [syncOffsetMs, setSyncOffsetMs] = useState(0);
  const [view, setView] = useState<ViewOptions>(DEFAULT_VIEW_OPTIONS);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [loadKey, setLoadKey] = useState(0);

  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const loopRef = useRef<{ a: number | null; b: number | null }>({ a: null, b: null });
  const handFilterRef = useRef<HandFilter>("both");
  const maxDurRef = useRef(0);
  const clockRef = useRef(new MediaClock());
  const syncOffsetRef = useRef(0);
  const viewRef = useRef<ViewOptions>(DEFAULT_VIEW_OPTIONS);
  const durationRef = useRef(0);
  const lastUiUpdateRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTranscription(null);
    setAudioSrc(null);
    setAudioReady(false);
    Promise.all([data.getTranscription(id), data.getAudioUrl(id)])
      .then(([t, url]) => {
        if (cancelled) return;
        maxDurRef.current = maxDuration(t.notes);
        durationRef.current = t.duration;
        setTranscription(t);
        setAudioSrc(url);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(friendlyLoadError(e.message));
        setLoading(false);
      });
    setMarkers(loadMarkers(id));
    const savedView = loadViewOptions();
    viewRef.current = savedView;
    setView(savedView);
    const offset = loadSyncOffsetMs();
    syncOffsetRef.current = offset;
    setSyncOffsetMs(offset);
    return () => {
      cancelled = true;
    };
  }, [id, data, loadKey]);

  useEffect(() => {
    loopRef.current = { a: loopA, b: loopB };
  }, [loopA, loopB]);

  useEffect(() => {
    handFilterRef.current = handFilter;
  }, [handFilter]);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Bucle de render: audio.currentTime → canvas (sin setState a 60 fps).
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

    const resetClock = () => clockRef.current.reset();
    for (const ev of ["seeked", "ratechange", "play", "pause"]) {
      audio.addEventListener(ev, resetClock);
    }

    const tick = () => {
      const now = performance.now();
      const t = clockRef.current.update({
        mediaTime: audio.currentTime,
        nowMs: now,
        playbackRate: audio.playbackRate,
        paused: audio.paused,
        seeking: audio.seeking,
      });

      const { a, b } = loopRef.current;
      const wrap = loopWrapTarget(t, a, b);
      if (wrap !== null) {
        audio.currentTime = wrap;
        clockRef.current.reset();
      }

      const renderTime = t + syncOffsetRef.current / 1000;

      drawFrame(ctx, cssWidth, cssHeight, {
        notes: transcription.notes,
        maxNoteDuration: maxDurRef.current,
        currentTime: renderTime,
        loopA: a,
        loopB: b,
        handFilter: handFilterRef.current,
        view: viewRef.current,
      });

      // UI clock: ~10 Hz (o al pausar / seek grande) — evita re-render React a 60 fps.
      if (audio.paused || now - lastUiUpdateRef.current > 100) {
        lastUiUpdateRef.current = now;
        setDisplayTime(t);
      }
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

  const seek = useCallback((t: number) => {
    const audio = audioRef.current;
    const { a, b } = loopRef.current;
    const next = coerceSeekIntoLoop(t, a, b, durationRef.current);
    if (audio) {
      audio.currentTime = next;
      clockRef.current.reset();
    }
    setDisplayTime(next);
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setError("No se pudo reproducir el audio. Pulsa de nuevo o recarga."));
    else audio.pause();
  }, []);

  const changeSpeed = useCallback((rate: number) => {
    const audio = audioRef.current;
    if (audio) {
      audio.preservesPitch = true;
      (audio as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
      audio.playbackRate = rate;
      clockRef.current.reset();
    }
    setSpeed(rate);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const root = rootRef.current;
    if (!root) return;
    try {
      if (!document.fullscreenElement) await root.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      /* fullscreen bloqueado por el navegador */
    }
  }, []);

  // Atajos: Space play/pause, ←/→ seek. No interferir en inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (e.code === "ArrowLeft") {
        e.preventDefault();
        const audio = audioRef.current;
        const t = audio?.currentTime ?? displayTime;
        const { a, b } = loopRef.current;
        seek(nudgeTime(t, -SEEK_STEP_SECONDS, durationRef.current, a, b));
        return;
      }
      if (e.code === "ArrowRight") {
        e.preventDefault();
        const audio = audioRef.current;
        const t = audio?.currentTime ?? displayTime;
        const { a, b } = loopRef.current;
        seek(nudgeTime(t, SEEK_STEP_SECONDS, durationRef.current, a, b));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, seek, displayTime]);

  const changeSyncOffset = (deltaMs: number) => {
    const next = Math.max(-500, Math.min(500, syncOffsetRef.current + deltaMs));
    syncOffsetRef.current = next;
    setSyncOffsetMs(next);
    saveSyncOffsetMs(next);
  };

  const updateView = (patch: Partial<ViewOptions>) => {
    const next = { ...viewRef.current, ...patch };
    viewRef.current = next;
    setView(next);
    saveViewOptions(next);
  };

  const resetSyncOffset = () => {
    syncOffsetRef.current = 0;
    setSyncOffsetMs(0);
    saveSyncOffsetMs(0);
  };

  const markA = () => {
    const t = audioRef.current?.currentTime ?? 0;
    setLoopA(t);
    setLoopArmed(true);
    if (loopB !== null && loopB <= t) setLoopB(null);
  };
  const markB = () => {
    const t = audioRef.current?.currentTime ?? 0;
    if (loopA !== null && t > loopA) {
      setLoopB(t);
      setLoopArmed(true);
    }
  };
  const clearLoop = () => {
    setLoopA(null);
    setLoopB(null);
    setLoopArmed(false);
  };
  const armLoopFromHere = () => {
    if (loopA !== null && loopB !== null) {
      clearLoop();
      return;
    }
    markA();
  };

  const addMarker = () => {
    const t = audioRef.current?.currentTime ?? 0;
    const next = [...markers, { name: `M${markers.length + 1}`, t }].sort((a, b) => a.t - b.t);
    setMarkers(next);
    saveMarkers(id, next);
  };

  const removeMarker = (index: number) => {
    const next = markers.filter((_, i) => i !== index);
    setMarkers(next);
    saveMarkers(id, next);
  };

  if (error && !transcription) {
    return (
      <div className="message tutorial-error">
        <p>{error}</p>
        <div className="tutorial-error-actions">
          <button className="btn active" type="button" onClick={() => setLoadKey((k) => k + 1)}>
            Reintentar
          </button>
          <Link href="/" className="btn">
            ← Tus canciones
          </Link>
        </div>
      </div>
    );
  }

  if (loading || !transcription || !audioSrc) {
    return (
      <div className="message" role="status">
        Preparando tu tutorial…
      </div>
    );
  }

  const duration = transcription.duration;
  const hasHands = transcription.notes.some((n) => n.hand !== null);
  const loopActive = loopA !== null && loopB !== null;

  return (
    <div className="tutorial" ref={rootRef}>
      <div ref={containerRef} className="stage">
        <canvas ref={canvasRef} aria-hidden className="stage-canvas" />
        {!audioReady && (
          <div className="stage-loading" role="status">
            Cargando audio…
          </div>
        )}
        <div className={`rotate-hint${rotateDismissed ? "" : " visible"}`}>
          <div>
            Gira el teléfono a horizontal: el teclado se lee mucho mejor.
            <br />
            <button className="btn" type="button" onClick={() => setRotateDismissed(true)}>
              Seguir en vertical
            </button>
          </div>
        </div>
      </div>

      <div className="controls controls-primary">
        <Link href="/" className="back" aria-label="Volver a tus canciones">
          ←
        </Link>
        <button
          className="btn"
          type="button"
          onClick={togglePlay}
          aria-label={isPlaying ? "Pausar" : "Reproducir"}
          title={isPlaying ? "Pausar (Espacio)" : "Reproducir (Espacio)"}
        >
          {isPlaying ? "Pausa" : "Play"}
        </button>

        <span className="time" aria-live="off">
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
          aria-label="Posición en la canción"
        />

        <span className="group" role="group" aria-label="Velocidad">
          {PLAYBACK_SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => changeSpeed(s)}
              className={`btn small${speed === s ? " active" : ""}`}
              aria-pressed={speed === s}
              title={`Velocidad ${s}x`}
            >
              {s === 1 ? "1x" : `${s}x`}
            </button>
          ))}
        </span>

        <span className="group" role="group" aria-label="Loop de práctica">
          <button
            className={`btn small${loopArmed || loopActive ? " active" : ""}`}
            type="button"
            onClick={armLoopFromHere}
            title={loopActive ? "Quitar loop" : "Activar loop: marca inicio A en la posición actual"}
            aria-pressed={loopActive}
          >
            Loop
          </button>
          <button
            className="btn small"
            type="button"
            onClick={markA}
            title="Marcar inicio del loop (A)"
          >
            A{loopA !== null ? ` ${formatTime(loopA)}` : ""}
          </button>
          <button
            className="btn small"
            type="button"
            onClick={markB}
            disabled={loopA === null}
            title="Marcar final del loop (B)"
          >
            B{loopB !== null ? ` ${formatTime(loopB)}` : ""}
          </button>
          {(loopA !== null || loopB !== null) && (
            <button className="btn small" type="button" onClick={clearLoop} aria-label="Quitar loop">
              Clear
            </button>
          )}
        </span>

        <button
          className="btn small"
          type="button"
          onClick={() => void toggleFullscreen()}
          title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
          aria-label={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
        >
          {isFullscreen ? "Salir" : "Pantalla completa"}
        </button>
      </div>

      <div className="controls controls-secondary">
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
                type="button"
                onClick={() => setHandFilter(value)}
                className={`btn small${handFilter === value ? " active" : ""}`}
                aria-pressed={handFilter === value}
                title="Separación de manos aproximada (heurística), no exacta"
              >
                {label}
              </button>
            ))}
          </span>
        )}

        <span className="group" role="group" aria-label="Duración visual de las notas">
          <span className="group-label">Duración</span>
          {DURATION_CAPS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              className={`btn small${view.noteDurationCap === opt.value ? " active" : ""}`}
              onClick={() => updateView({ noteDurationCap: opt.value })}
              title={
                opt.value === null
                  ? "Duración real detectada (con pedal las notas se alargan)"
                  : `Recortar cada nota a ${opt.value} s`
              }
            >
              {opt.label}
            </button>
          ))}
        </span>

        <button
          className={`btn small${view.showNoteNames ? " active" : ""}`}
          type="button"
          onClick={() => updateView({ showNoteNames: !view.showNoteNames })}
          title="Mostrar nombres de notas"
          aria-pressed={view.showNoteNames}
        >
          ABC
        </button>

        <span className="group" role="group" aria-label="Ajuste de sincronía">
          <button
            className="btn small"
            type="button"
            onClick={() => changeSyncOffset(-25)}
            title="Retrasar notas (−25 ms)"
          >
            −
          </button>
          <button
            className="btn small sync-value"
            type="button"
            onClick={resetSyncOffset}
            title="Sincronía audio/notas. Útil con auriculares Bluetooth. Clic para 0."
          >
            Sinc. {syncOffsetMs > 0 ? "+" : ""}
            {syncOffsetMs} ms
          </button>
          <button
            className="btn small"
            type="button"
            onClick={() => changeSyncOffset(25)}
            title="Adelantar notas (+25 ms)"
          >
            +
          </button>
        </span>

        <span className="group">
          <button className="btn small" type="button" onClick={addMarker} title="Guardar marcador en esta posición">
            + Marcador
          </button>
          {markers.map((m, i) => (
            <span key={`${m.t}-${i}`} className="marker">
              <button className="jump" type="button" onClick={() => seek(m.t)}>
                {m.name} {formatTime(m.t)}
              </button>
              <button
                className="remove"
                type="button"
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
        onEnded={() => {
          setIsPlaying(false);
          // Al terminar sin loop activo, dejar al inicio para re-practica.
          if (loopA === null || loopB === null) {
            seek(resetPlaybackTime());
          }
        }}
        onCanPlay={() => setAudioReady(true)}
        onError={() => setError("No se pudo cargar el audio de esta canción.")}
        preload="auto"
      />

      <p className="hint">
        Espacio: play/pausa · ←/→: ±{SEEK_STEP_SECONDS}s · Loop: A→B ·{" "}
        {hasHands ? "Verde ≈ derecha, azul ≈ izquierda (aproximado) · " : ""}
        {transcription.notes.length} notas
      </p>
    </div>
  );
}
