/**
 * ActivityLog retention — env-driven cutoff for queries and the
 * `activity-log-reaper` BullMQ task.
 *
 * `KRWN_ACTIVITY_LOG_RETENTION_DAYS`:
 *   - unset → 365 (keep roughly one year)
 *   - `0` → unlimited (no SQL cutoff, reaper deletes nothing)
 *   - positive integer → days to keep (floor: from start of UTC day optional — we use exact Date.now() - days * 86400000)
 */

const DEFAULT_RETENTION_DAYS = 365;

export function getActivityLogRetentionDaysFromEnv(): number | null {
  const raw = process.env.KRWN_ACTIVITY_LOG_RETENTION_DAYS;
  if (raw === undefined || raw === null || raw.trim() === "") {
    return DEFAULT_RETENTION_DAYS;
  }
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n < 0) return DEFAULT_RETENTION_DAYS;
  if (n === 0) return null;
  return Math.floor(n);
}

/** Cutoff instant: rows with createdAt < this may be purged / are hidden. */
export function getActivityLogRetentionCutoff(now: Date = new Date()): Date | null {
  const days = getActivityLogRetentionDaysFromEnv();
  if (days === null) return null;
  return new Date(now.getTime() - days * 86_400_000);
}
