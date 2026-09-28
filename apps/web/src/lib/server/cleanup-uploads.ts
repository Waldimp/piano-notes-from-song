/**
 * Expired-upload cleanup (bucket "uploads").
 *
 * The decision lives in SQL (public.list_expired_uploads, migration 0017):
 * objects older than 24 h that no queued/processing request needs, that are
 * not a recent terminal request, and that are not a FREE preview still within
 * its 30-day unlock window. Deletion must go through the Storage API so the
 * physical object is removed too.
 */

import { serviceClient } from "./auth";

export type CleanupReport = {
  candidates: number;
  deleted: number;
  failed: number;
  reasons: Record<string, number>;
};

export async function cleanupExpiredUploads(limit = 200): Promise<CleanupReport> {
  const admin = serviceClient();
  const { data, error } = await admin.rpc("list_expired_uploads", {
    p_min_age_hours: 24,
    p_preview_retention_days: 30,
    p_limit: limit,
  });
  if (error) throw new Error(`list_expired_uploads: ${error.message}`);

  const rows = (data ?? []) as Array<{ object_name: string; reason: string }>;
  const report: CleanupReport = { candidates: rows.length, deleted: 0, failed: 0, reasons: {} };
  for (const r of rows) report.reasons[r.reason] = (report.reasons[r.reason] ?? 0) + 1;
  if (rows.length === 0) return report;

  // Remove in small batches; a failed batch must not abort the rest.
  const names = rows.map((r) => r.object_name);
  for (let i = 0; i < names.length; i += 50) {
    const batch = names.slice(i, i + 50);
    const { data: removed, error: rmError } = await admin.storage.from("uploads").remove(batch);
    if (rmError) {
      report.failed += batch.length;
      continue;
    }
    report.deleted += removed?.length ?? 0;
    report.failed += batch.length - (removed?.length ?? 0);
  }
  return report;
}
