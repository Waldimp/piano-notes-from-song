/** Fuente de datos nube: Supabase (Postgres + Storage), protegida por login + RLS. */

import type { PianoTranscription } from "@piano/contracts";
import { isPianoTranscription } from "@piano/contracts";

import { mapCreateRequestError } from "../userMessages";
import { supabase } from "../supabase";
import type { DataSource, JobState, JobStatus, SongSummary } from "./types";

/** Las URLs firmadas duran 12 h: una sesion larga de practica sin recargar. */
const SIGNED_URL_SECONDS = 12 * 60 * 60;

const SONG_COLUMNS =
  "id,title,filename,duration,note_count,pedal_count,engine,created_at,preview_seconds,source_duration_seconds";

/** Mismo criterio que el backend/worker: id seguro derivado del nombre. */
function slugify(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "");
  return stem.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+|[._]+$/g, "") || "audio";
}

interface RequestRow {
  id: string;
  filename: string;
  status: JobStatus;
  song_id: string | null;
  error: string | null;
  created_at: string;
  preview_seconds?: number | null;
}

interface SongRow {
  id: string;
  title: string;
  filename: string;
  duration: number;
  note_count: number;
  pedal_count: number;
  engine: string;
  created_at: string;
  preview_seconds?: number | null;
  source_duration_seconds?: number | null;
}

function toSongSummary(r: SongRow): SongSummary {
  return {
    id: r.id,
    title: r.title,
    filename: r.filename,
    duration: Number(r.duration ?? 0),
    note_count: r.note_count ?? 0,
    pedal_count: r.pedal_count ?? 0,
    engine: r.engine ?? "",
    created_at: r.created_at,
    preview_seconds: r.preview_seconds ?? null,
    source_duration_seconds: r.source_duration_seconds ?? null,
  };
}

function toJobState(r: RequestRow, queuePosition: number | null = null): JobState {
  return {
    id: r.id,
    status: r.status,
    filename: r.filename,
    transcriptionId: r.song_id,
    error: r.error,
    queuePosition,
    createdAt: r.created_at,
    previewSeconds: r.preview_seconds ?? null,
  };
}

const REQUEST_COLUMNS = "id,filename,status,song_id,error,created_at,preview_seconds";

export const cloudDataSource: DataSource = {
  kind: "cloud",

  async listSongs(): Promise<SongSummary[]> {
    const { data, error } = await supabase()
      .from("songs")
      .select(SONG_COLUMNS)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`No se pudo listar la biblioteca: ${error.message}`);
    return (data as SongRow[]).map(toSongSummary);
  },

  async getSong(id: string): Promise<SongSummary | null> {
    const { data, error } = await supabase().from("songs").select(SONG_COLUMNS).eq("id", id).maybeSingle();
    if (error || !data) return null;
    return toSongSummary(data as SongRow);
  },

  async getTranscription(id: string): Promise<PianoTranscription> {
    const sb = supabase();
    const { data: row, error } = await sb.from("songs").select("notes_path").eq("id", id).single();
    if (error || !row) throw new Error("Canción no encontrada");
    const { data: blob, error: dlError } = await sb.storage.from("notes").download(row.notes_path);
    if (dlError || !blob) throw new Error(`No se pudo descargar notes.json: ${dlError?.message}`);
    const json = JSON.parse(await blob.text());
    if (!isPianoTranscription(json)) throw new Error("El notes.json no cumple el contrato v1");
    return json;
  },

  async getAudioUrl(id: string): Promise<string> {
    const sb = supabase();
    const { data: row, error } = await sb.from("songs").select("audio_path").eq("id", id).single();
    if (error || !row) throw new Error("Canción no encontrada");
    const { data, error: urlError } = await sb.storage
      .from("audio")
      .createSignedUrl(row.audio_path, SIGNED_URL_SECONDS);
    if (urlError || !data) throw new Error(`No se pudo obtener el audio: ${urlError?.message}`);
    return data.signedUrl;
  },

  async renameSong(id: string, title: string): Promise<void> {
    const { error } = await supabase().from("songs").update({ title }).eq("id", id);
    if (error) throw new Error(`No se pudo renombrar: ${error.message}`);
  },

  async deleteSong(id: string): Promise<void> {
    const sb = supabase();
    const { data: row } = await sb.from("songs").select("audio_path,notes_path").eq("id", id).single();
    if (row) {
      await sb.storage.from("audio").remove([row.audio_path]);
      await sb.storage.from("notes").remove([row.notes_path]);
    }
    const { error } = await sb.from("songs").delete().eq("id", id);
    if (error) throw new Error(`No se pudo eliminar: ${error.message}`);
  },

  async submitAudio(file: File): Promise<string> {
    const sb = supabase();
    const { data: userData } = await sb.auth.getUser();
    if (!userData.user) throw new Error("Debes iniciar sesión");
    const { data: sessionData } = await sb.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("Sesión inválida");

    const ext = file.name.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? ".mp3";
    const path = `${userData.user.id}/${crypto.randomUUID()}/${slugify(file.name)}${ext}`;
    const { error: upError } = await sb.storage.from("uploads").upload(path, file, {
      contentType: file.type || undefined,
    });
    if (upError) throw new Error(`No se pudo subir el audio: ${upError.message}`);

    const response = await fetch("/api/create-request", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filename: file.name, audio_path: path }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      request_id?: string;
      message?: string;
      error?: string;
      code?: string;
    };
    if (!response.ok || !payload.request_id) {
      const msg = mapCreateRequestError({
        code: payload.code,
        message: payload.message,
        error: payload.error,
        status: response.status,
      });
      throw new Error(msg);
    }
    return payload.request_id;
  },

  async getJob(jobId: string): Promise<JobState> {
    const sb = supabase();
    const { data, error } = await sb.from("requests").select(REQUEST_COLUMNS).eq("id", jobId).single();
    if (error || !data) throw new Error("Solicitud no encontrada");
    const row = data as RequestRow;

    let position: number | null = null;
    if (row.status === "queued") {
      const { count } = await sb
        .from("requests")
        .select("id", { count: "exact", head: true })
        .in("status", ["queued", "processing"])
        .lte("created_at", row.created_at);
      position = count ?? null;
    }
    return toJobState(row, position);
  },

  async listJobs(): Promise<JobState[]> {
    const { data, error } = await supabase()
      .from("requests")
      .select(REQUEST_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(`No se pudieron listar las solicitudes: ${error.message}`);
    return (data as RequestRow[]).map((r) => toJobState(r));
  },
};
