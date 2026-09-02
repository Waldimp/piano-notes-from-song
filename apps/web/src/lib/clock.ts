/**
 * Reloj de reproducción suavizado.
 *
 * El elemento <audio> sigue siendo la fuente autoritativa de tiempo, pero en
 * varios navegadores (Safari/iOS sobre todo) `currentTime` se actualiza a
 * saltos gruesos (~100–250 ms) en vez de continuamente. Si se dibuja con ese
 * valor crudo, las notas avanzan a trompicones y, tras cambiar la velocidad
 * o hacer seek, la lectura puede quedar "vieja" varios frames.
 *
 * Estrategia: cada vez que `currentTime` cambia, se toma como ancla junto con
 * `performance.now()`. Entre anclas se interpola a la velocidad actual. Un
 * seek (salto grande respecto a lo predicho) o una pausa re-ancla al valor
 * reportado de inmediato. Nunca se acumula deriva: la siguiente lectura real
 * siempre manda.
 */

export interface ClockSample {
  /** audio.currentTime en segundos. */
  mediaTime: number;
  /** performance.now() en milisegundos. */
  nowMs: number;
  playbackRate: number;
  paused: boolean;
  seeking: boolean;
}

/** Diferencia (s) a partir de la cual una lectura se considera un seek, no jitter. */
export const SEEK_THRESHOLD_SECONDS = 0.25;
/** Tope de extrapolación: si el audio no reporta nada en este tiempo, no se avanza más. */
export const MAX_EXTRAPOLATION_SECONDS = 0.6;

export class MediaClock {
  private anchorMedia = 0;
  private anchorNowMs = 0;
  private lastReported = NaN;
  private initialized = false;

  /** Reinicia las anclas (p. ej. tras cambiar la velocidad o hacer seek). */
  reset(): void {
    this.initialized = false;
    this.lastReported = NaN;
  }

  /** Devuelve el tiempo estimado de reproducción para dibujar este frame. */
  update(s: ClockSample): number {
    // Pausado o buscando: no hay avance; el valor reportado es la verdad.
    if (s.paused || s.seeking) {
      this.anchor(s.mediaTime, s.nowMs);
      this.lastReported = s.mediaTime;
      return s.mediaTime;
    }

    if (!this.initialized) {
      this.anchor(s.mediaTime, s.nowMs);
      this.lastReported = s.mediaTime;
      return s.mediaTime;
    }

    const predicted = this.extrapolate(s.nowMs, s.playbackRate);

    if (s.mediaTime !== this.lastReported) {
      // Lectura nueva del audio. Si es un salto grande => seek: aceptar tal cual.
      // Si es una lectura normal, re-anclar en ella (manda el audio).
      this.lastReported = s.mediaTime;
      this.anchor(s.mediaTime, s.nowMs);
      if (Math.abs(s.mediaTime - predicted) > SEEK_THRESHOLD_SECONDS) {
        return s.mediaTime;
      }
      // Para no retroceder visualmente unos ms cuando la lectura llega "tarde",
      // usar el mayor de ambos: la predicción nunca supera la verdad por más
      // que un frame de más.
      return Math.max(s.mediaTime, Math.min(predicted, s.mediaTime + 0.05));
    }

    return predicted;
  }

  private anchor(mediaTime: number, nowMs: number): void {
    this.anchorMedia = mediaTime;
    this.anchorNowMs = nowMs;
    this.initialized = true;
  }

  private extrapolate(nowMs: number, rate: number): number {
    const elapsed = Math.max(0, (nowMs - this.anchorNowMs) / 1000);
    const capped = Math.min(elapsed, MAX_EXTRAPOLATION_SECONDS);
    return this.anchorMedia + capped * rate;
  }
}

const SYNC_KEY = "piano:syncOffsetMs";

/** Compensación de latencia del dispositivo (p. ej. auriculares Bluetooth), en ms. */
export function loadSyncOffsetMs(): number {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    const n = raw === null ? 0 : Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function saveSyncOffsetMs(ms: number): void {
  try {
    localStorage.setItem(SYNC_KEY, String(ms));
  } catch {
    // sin almacenamiento: vive solo en la sesión
  }
}
