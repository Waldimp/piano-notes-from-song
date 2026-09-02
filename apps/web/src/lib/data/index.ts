import { isCloudMode } from "../supabase";
import { cloudDataSource } from "./cloud";
import { localDataSource } from "./local";
import type { DataSource } from "./types";

export type { DataSource, JobState, JobStatus, SongSummary } from "./types";

/** Nube si hay Supabase configurado (Vercel); local si no (tu PC). */
export function getDataSource(): DataSource {
  return isCloudMode ? cloudDataSource : localDataSource;
}
