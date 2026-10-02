/**
 * Preferencias ligeras del usuario en el navegador (sin backend): estilos
 * musicales favoritos y si ya vio la bienvenida.
 */

export type Genre = { id: string; label: string; tone: "m" | "p" | "c" | "v" | "k" | "a" };

export const GENRES: Genre[] = [
  { id: "pop", label: "pop", tone: "p" },
  { id: "clasico", label: "clásico", tone: "k" },
  { id: "rock", label: "rock", tone: "c" },
  { id: "anime", label: "anime", tone: "v" },
  { id: "lofi", label: "lofi", tone: "a" },
  { id: "baladas", label: "baladas", tone: "k" },
  { id: "bandas_sonoras", label: "bandas sonoras", tone: "v" },
  { id: "instrumental", label: "instrumental", tone: "m" },
  { id: "kpop", label: "k-pop", tone: "c" },
  { id: "tropical", label: "tropical", tone: "m" },
];

const STYLES_KEY = "pianissimo_styles_v1";
const ONBOARDED_KEY = "pianissimo_onboarded_v1";

export function loadStyles(): string[] {
  try {
    const raw = localStorage.getItem(STYLES_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveStyles(ids: string[]): void {
  try {
    localStorage.setItem(STYLES_KEY, JSON.stringify(ids));
  } catch {
    /* solo sesión */
  }
}

export function isOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === "1";
  } catch {
    return true;
  }
}

export function markOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDED_KEY, "1");
  } catch {
    /* solo sesión */
  }
}

export function genreLabel(id: string): string {
  return GENRES.find((g) => g.id === id)?.label ?? id;
}

export function genreTone(id: string): Genre["tone"] {
  return GENRES.find((g) => g.id === id)?.tone ?? "a";
}
