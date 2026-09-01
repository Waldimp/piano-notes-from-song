/** Acceso al backend local. El frontend solo conoce el contrato normalizado. */

import type { PianoTranscription } from "@piano/contracts";
import { isPianoTranscription } from "@piano/contracts";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8010";

export async function fetchTranscriptionList(): Promise<{ id: string }[]> {
  const res = await fetch(`${API_URL}/api/transcriptions`);
  if (!res.ok) throw new Error(`API respondió ${res.status}`);
  return res.json();
}

export async function fetchNotes(id: string): Promise<PianoTranscription> {
  const res = await fetch(`${API_URL}/api/transcriptions/${id}/notes`);
  if (!res.ok) throw new Error(`No se pudo cargar notes.json (${res.status})`);
  const data = await res.json();
  if (!isPianoTranscription(data)) {
    throw new Error("El notes.json recibido no cumple el contrato v1");
  }
  return data;
}

export function audioUrl(id: string): string {
  return `${API_URL}/api/transcriptions/${id}/audio`;
}
