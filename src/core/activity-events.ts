/**
 * Activity feed bus / SSE / WS event names — no server-only imports (safe for client).
 */
export const ACTIVITY_EVENTS = {
  /**
   * Публикуется после успешной записи строки в БД; слушают realtime-каналы.
   */
  Recorded: "core.activity.recorded",
} as const;
