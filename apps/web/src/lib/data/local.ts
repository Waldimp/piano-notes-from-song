/** Fuente de datos local: el backend FastAPI de tu PC (puerto 8010). */

import type { PianoTranscription } from "@piano/contracts";
import { isPianoTranscription } from "@piano/contracts";

import type { DataSource, JobState, SongSummary } from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8010";

async function expectOk(res: Response, what: string): Promise<Response> {
  if (!res.ok) {
    const detail = await res.json().then((d) => d.detail).catch(() => res.statusText);
    throw new Error(`${what} (${res.status}): ${detail}`);
  }
  return res;
}

export const localDataSource: DataSource = {
  kind: "local",

  async listSongs(): Promise<SongSummary[]> {
    // no-store: son datos locales que cambian (retranscripciones, renombres).
    const res = await fetch(`${API_URL}/api/transcriptions`, { cache: "no-store" });
    return (await expectOk(res, "No se pudo listar la biblioteca")).json();
  },

  async getTranscription(id: string): Promise<PianoTranscription> {
    const res = await fetch(`${API_URL}/api/transcriptions/${id}/notes`, { cache: "no-store" });
    const data = await (await expectOk(res, "No se pudo cargar notes.json")).json();
    if (!isPianoTranscription(data)) throw new Error("El notes.json no cumple el contrato v1");
    return data;
  },

  async getAudioUrl(id: string): Promise<string> {
    return `${API_URL}/api/transcriptions/${id}/audio`;
  },

  async renameSong(id: string, title: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/transcriptions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    await expectOk(res, "No se pudo renombrar");
  },

  async deleteSong(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/transcriptions/${id}`, { method: "DELETE" });
    await expectOk(res, "No se pudo eliminar");
  },

  async submitAudio(file: File): Promise<string> {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(`${API_URL}/api/jobs`, { method: "POST", body });
    const { jobId } = await (await expectOk(res, "No se pudo subir")).json();
    return jobId;
  },

  async getJob(jobId: string): Promise<JobState> {
    const res = await fetch(`${API_URL}/api/jobs/${jobId}`, { cache: "no-store" });
    const j = await (await expectOk(res, "No se pudo consultar el job")).json();
    return {
      id: j.id,
      status: j.status,
      filename: j.filename,
      transcriptionId: j.transcription_id ?? null,
      error: j.error ?? null,
      queuePosition: j.queuePosition ?? null,
      createdAt: new Date(j.created_at * 1000).toISOString(),
    };
  },

  async listJobs(): Promise<JobState[]> {
    return [];
  },
};
