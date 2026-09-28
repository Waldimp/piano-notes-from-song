/** Fuente de datos local: el backend FastAPI de tu PC (puerto 8010 por defecto). */

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

type LocalSongRow = Omit<SongSummary, "preview_seconds" | "source_duration_seconds"> & {
  preview_seconds?: number | null;
  source_duration_seconds?: number | null;
};

function normalise(row: LocalSongRow): SongSummary {
  return {
    ...row,
    preview_seconds: row.preview_seconds ?? null,
    source_duration_seconds: row.source_duration_seconds ?? null,
  };
}

async function fetchSongs(): Promise<SongSummary[]> {
  // no-store: son datos locales que cambian (retranscripciones, renombres).
  const res = await fetch(`${API_URL}/api/transcriptions`, { cache: "no-store" });
  const rows = (await (await expectOk(res, "No se pudo listar la biblioteca")).json()) as LocalSongRow[];
  return rows.map(normalise);
}

export const localDataSource: DataSource = {
  kind: "local",

  listSongs: fetchSongs,

  async getSong(id: string): Promise<SongSummary | null> {
    const songs = await fetchSongs();
    return songs.find((s) => s.id === id) ?? null;
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
      previewSeconds: null,
    };
  },

  async listJobs(): Promise<JobState[]> {
    return [];
  },
};
