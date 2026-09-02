import type { PianoTranscription } from "@piano/contracts";

export interface SongSummary {
  id: string;
  title: string;
  filename: string;
  duration: number;
  note_count: number;
  pedal_count: number;
  engine: string;
  created_at: string;
}

export type JobStatus = "queued" | "processing" | "done" | "error";

export interface JobState {
  id: string;
  status: JobStatus;
  filename: string;
  transcriptionId: string | null;
  error: string | null;
  queuePosition: number | null;
  createdAt: string;
}

/**
 * Lo que la UI necesita de "donde viven los datos". Dos implementaciones:
 * local (FastAPI en tu PC) y nube (Supabase). La UI no sabe cual usa.
 */
export interface DataSource {
  readonly kind: "local" | "cloud";
  listSongs(): Promise<SongSummary[]>;
  getTranscription(id: string): Promise<PianoTranscription>;
  getAudioUrl(id: string): Promise<string>;
  renameSong(id: string, title: string): Promise<void>;
  deleteSong(id: string): Promise<void>;
  /** Sube un audio para transcribir; devuelve el id del job/solicitud. */
  submitAudio(file: File): Promise<string>;
  getJob(jobId: string): Promise<JobState>;
  /** Solicitudes recientes (solo tiene sentido en la nube; local devuelve []). */
  listJobs(): Promise<JobState[]>;
}
