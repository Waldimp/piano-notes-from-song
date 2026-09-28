"use client";

/**
 * Reproductor de notas que caen — la parte estrella del producto.
 *
 * Sincronización: el elemento <audio> es el reloj autoritativo. Cada frame
 * (requestAnimationFrame) lee audio.currentTime vía MediaClock y pinta el canvas.
 * React sólo se actualiza para la UI (tiempo/controles), no a 60 fps.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PianoTranscription } from "@piano/contracts";

import { useUsage } from "@/components/UsageBanner";
import { formatClock, isPreviewSong, unlockDecision } from "@/lib/beta/preview";
import { MediaClock, loadSyncOffsetMs, saveSyncOffsetMs } from "@/lib/clock";
import { type SongSummary, getDataSource } from "@/lib/data";
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
import { isCloudMode, supabase } from "@/lib/supabase";
import { mapCreateRequestError } from "@/lib/userMessages";

const VIEW_KEY = "piano:viewOptions";
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
    return "No encontramos el tutorial de esta canción. Puede que aún se esté procesando.";
  }
  if (lower.includes("notes.json") || lower.includes("contrato")) {
    return "Los datos del tutorial están incompletos. Vuelve a la biblioteca e inténtalo de nuevo.";
  }
  if (lower.includes("audio") || lower.includes("signed")) {
    return "No pudimos cargar el audio. Revisa tu conexión e inténtalo de nuevo.";
  }
  return "No pudimos cargar el tutorial. Inténtalo de nuevo en un momento.";
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export default function Tutorial({ id }: { id: string }) {
  const data = getDataSource();
  const router = useRouter();
  const { usage } = useUsage();
  const [transcription, setTranscription] = useState<PianoTranscription | null>(null);
  const [song, setSong] = useState<SongSummary | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1.0);
  const [displayTime, setDisplayTime] = useState(0);
  const [loopA, setLoopA] = useState<number | null>(null);
  const [loopB, setLoopB] = useState<number | null>(null);
  const [handFilter, setHandFilter] = useState<HandFilter>("both");
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [rotateDismissed, setRotateDismissed] = useState(false);
  const [syncOffsetMs, setSyncOffsetMs] = useState(0);
  const [view, setView] = useState<ViewOptions>(DEFAULT_VIEW_OPTIONS);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [loadKey, setLoadKey] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockMsg, setUnlockMsg] = useState<string | null>(null);
  const [idle, setIdle] = useState(false);

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
    Promise.all([data.getTranscription(id), data.getAudioUrl(id), data.getSong(id)])
      .then(([t, url, meta]) => {
        if (cancelled) return;
        maxDurRef.current = maxDuration(t.notes);
        durationRef.current = t.duration;
        setTranscription(t);
        setAudioSrc(url);
        setSong(meta);
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

      drawFrame(ctx, cssWidth, cssHeight, {
        notes: transcription.notes,
        maxNoteDuration: maxDurRef.current,
        currentTime: t + syncOffsetRef.current / 1000,
        loopA: a,
        loopB: b,
        handFilter: handFilterRef.current,
        view: viewRef.current,
      });

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

  // Escenario limpio: en pantalla completa y reproduciendo, el chrome se
  // esconde tras unos segundos sin mover el ratón o tocar la pantalla.
  useEffect(() => {
    if (!isFullscreen || !isPlaying) {
      setIdle(false);
      return;
    }
    let timer: number | undefined;
    const arm = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), 2800);
    };
    arm();
    const events: Array<keyof WindowEventMap> = ["mousemove", "pointerdown", "touchstart", "keydown"];
    for (const ev of events) window.addEventListener(ev, arm, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const ev of events) window.removeEventListener(ev, arm);
    };
  }, [isFullscreen, isPlaying]);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        e.preventDefault();
        const audio = audioRef.current;
        const t = audio?.currentTime ?? displayTime;
        const { a, b } = loopRef.current;
        const delta = e.code === "ArrowLeft" ? -SEEK_STEP_SECONDS : SEEK_STEP_SECONDS;
        seek(nudgeTime(t, delta, durationRef.current, a, b));
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
    const next = [...markers, { name: `M${markers.length + 1}`, t }].sort((a, b) => a.t - b.t);
    setMarkers(next);
    saveMarkers(id, next);
  };
  const removeMarker = (index: number) => {
    const next = markers.filter((_, i) => i !== index);
    setMarkers(next);
    saveMarkers(id, next);
  };

  const unlock = async () => {
    if (!song) return;
    const decision = unlockDecision(song, usage?.plan_code ?? "free", usage?.credit_balance ?? 0);
    if (decision.action !== "unlock") {
      router.push("/pricing");
      return;
    }
    setUnlockBusy(true);
    setUnlockMsg(null);
    try {
      const { data: session } = await supabase().auth.getSession();
      const token = session.session?.access_token;
      if (!token) return;
      const res = await fetch("/api/unlock-song", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ song_id: song.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUnlockMsg(mapCreateRequestError({ code: body.code, message: body.message, error: body.error, status: res.status }));
        return;
      }
      router.push("/");
    } finally {
      setUnlockBusy(false);
    }
  };

  if (error && !transcription) {
    return (
      <div className="tutorial-error">
        <div className="card pad-lg" style={{ maxWidth: 460 }}>
          <h2>Ups</h2>
          <p className="muted" style={{ marginTop: "0.5rem" }}>
            {error}
          </p>
          <div className="row" style={{ justifyContent: "center", marginTop: "1.25rem" }}>
            <button className="btn primary" type="button" onClick={() => setLoadKey((k) => k + 1)}>
              Reintentar
            </button>
            <Link href="/" className="btn">
              Tus canciones
            </Link>
          </div>
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
  const preview = song ? isPreviewSong(song) : false;
  const decision = song ? unlockDecision(song, usage?.plan_code ?? "free", usage?.credit_balance ?? 0) : { action: "none" as const };
  const pct = duration > 0 ? Math.min(100, (displayTime / duration) * 100) : 0;
  const title = song?.title ?? "Tutorial";

  return (
    <div className={`player${idle ? " idle" : ""}`} ref={rootRef}>
      <div className="player-top">
        <Link href="/" className="btn icon ghost" aria-label="Volver a tus canciones" title="Tus canciones">
          ←
        </Link>
        <span className="title" title={title}>
          {title}
        </span>
        {preview && <span className="pill gold">Vista previa</span>}
        <button
          className="btn icon ghost"
          type="button"
          onClick={() => void toggleFullscreen()}
          title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
          aria-label={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
        >
          {isFullscreen ? "⤡" : "⤢"}
        </button>
      </div>

      <div ref={containerRef} className="stage">
        <canvas ref={canvasRef} aria-hidden className="stage-canvas" />
        {!audioReady && (
          <div className="stage-loading" role="status">
            Cargando audio…
          </div>
        )}
        {preview && isCloudMode && (
          <div className="preview-banner" role="status">
            <span>
              Vista previa: {formatClock(song?.preview_seconds ?? duration)}
              {song?.source_duration_seconds ? ` de ${formatClock(song.source_duration_seconds)}` : ""}
            </span>
            <button className="btn primary small" type="button" onClick={() => void unlock()} disabled={unlockBusy}>
              {unlockBusy ? "Procesando…" : decision.action === "unlock" ? "Completa (1 tutorial)" : "Desbloquear completa"}
            </button>
          </div>
        )}
        {unlockMsg && (
          <div className="preview-banner" role="alert" style={{ bottom: "auto", top: "10%" }}>
            <span>{unlockMsg}</span>
            <button className="btn xs ghost" type="button" onClick={() => setUnlockMsg(null)} aria-label="Cerrar">
              ✕
            </button>
          </div>
        )}
        <div className={`rotate-hint${rotateDismissed ? "" : " visible"}`}>
          <div className="card pad-lg" style={{ maxWidth: 360 }}>
            <h3>Gira el teléfono</h3>
            <p className="muted" style={{ marginTop: "0.4rem" }}>
              En horizontal las 88 teclas se ven mucho mejor.
            </p>
            <button className="btn" type="button" style={{ marginTop: "1rem" }} onClick={() => setRotateDismissed(true)}>
              Seguir en vertical
            </button>
          </div>
        </div>
      </div>

      <div className="player-dock">
        <div className="transport">
          <button
            className="play-btn"
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? "Pausar" : "Reproducir"}
            title={isPlaying ? "Pausar (Espacio)" : "Reproducir (Espacio)"}
          >
            {isPlaying ? "❚❚" : "▶"}
          </button>
          <span className="time" aria-live="off">
            {formatClock(displayTime)} / {formatClock(duration)}
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
            style={{ ["--pct" as string]: `${pct}%` }}
          />
          <div className="seg" role="group" aria-label="Velocidad">
            {PLAYBACK_SPEEDS.map((s) => (
              <button key={s} type="button" onClick={() => changeSpeed(s)} aria-pressed={speed === s} title={`Velocidad ${s}x`}>
                {s === 1 ? "1x" : `${s}x`}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Loop de práctica">
            <span className="seg-label">Loop</span>
            <button type="button" onClick={markA} title="Marcar inicio (A)" aria-pressed={loopA !== null}>
              A{loopA !== null ? ` ${formatClock(loopA)}` : ""}
            </button>
            <button type="button" onClick={markB} disabled={loopA === null} title="Marcar final (B)" aria-pressed={loopB !== null}>
              B{loopB !== null ? ` ${formatClock(loopB)}` : ""}
            </button>
            {(loopA !== null || loopB !== null) && (
              <button type="button" onClick={clearLoop} aria-label="Quitar loop" className={loopActive ? "on" : ""}>
                ✕
              </button>
            )}
          </div>
          <button
            className={`btn small${moreOpen ? " on" : ""}`}
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            aria-controls="player-more"
          >
            Ajustes
          </button>
        </div>

        <div id="player-more" className={`controls-row secondary${moreOpen ? " open" : ""}`} hidden={!moreOpen}>
          {hasHands && (
            <div className="seg" role="group" aria-label="Manos">
              <span className="seg-label">Manos</span>
              {(
                [
                  ["both", "Ambas"],
                  ["left", "Izq."],
                  ["right", "Der."],
                ] as const
              ).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setHandFilter(value)} aria-pressed={handFilter === value} title="Separación aproximada de manos">
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="seg" role="group" aria-label="Duración visual de las notas">
            <span className="seg-label">Notas</span>
            {DURATION_CAPS.map((opt) => (
              <button
                key={opt.label}
                type="button"
                aria-pressed={view.noteDurationCap === opt.value}
                onClick={() => updateView({ noteDurationCap: opt.value })}
                title={opt.value === null ? "Duración real (con pedal se alargan)" : `Recortar cada nota a ${opt.value} s`}
              >
                {opt.label}
              </button>
            ))}
            <button type="button" aria-pressed={view.showNoteNames} onClick={() => updateView({ showNoteNames: !view.showNoteNames })} title="Nombres de las notas">
              ABC
            </button>
          </div>
          <div className="seg" role="group" aria-label="Ajuste de sincronía">
            <span className="seg-label">Sinc.</span>
            <button type="button" onClick={() => changeSyncOffset(-25)} title="Retrasar notas 25 ms">
              −
            </button>
            <button type="button" onClick={() => { syncOffsetRef.current = 0; setSyncOffsetMs(0); saveSyncOffsetMs(0); }} title="Útil con auriculares Bluetooth. Clic para volver a 0.">
              {syncOffsetMs > 0 ? "+" : ""}
              {syncOffsetMs} ms
            </button>
            <button type="button" onClick={() => changeSyncOffset(25)} title="Adelantar notas 25 ms">
              +
            </button>
          </div>
          <div className="group">
            <button className="btn small" type="button" onClick={addMarker} title="Guardar un marcador en esta posición">
              + Marcador
            </button>
            {markers.map((m, i) => (
              <span key={`${m.t}-${i}`} className="marker">
                <button className="jump" type="button" onClick={() => seek(m.t)}>
                  {m.name} {formatClock(m.t)}
                </button>
                <button className="remove" type="button" onClick={() => removeMarker(i)} aria-label={`Eliminar marcador ${m.name}`}>
                  ×
                </button>
              </span>
            ))}
          </div>
          <span className="hint">
            Espacio: play/pausa · ←/→: ±{SEEK_STEP_SECONDS}s{hasHands ? " · dorado ≈ derecha, azul ≈ izquierda" : ""} ·{" "}
            {transcription.notes.length} notas
          </span>
        </div>
      </div>

      <audio
        ref={audioRef}
        src={audioSrc}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          if (loopA === null || loopB === null) seek(resetPlaybackTime());
        }}
        onCanPlay={() => setAudioReady(true)}
        onError={() => setError("No se pudo cargar el audio de esta canción.")}
        preload="auto"
      />
    </div>
  );
}
