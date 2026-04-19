/**
 * Presence registry (кто сейчас онлайн).
 * ------------------------------------------------------------
 * По умолчанию — in-memory `userId → lastSeen` (малые single-node деплои).
 * При наличии `REDIS_URL` и если не выставлено `KRWN_PRESENCE_REDIS=0`,
 * дополнительно пишем ключи `krwn:presence:{userId}` с TTL — чтобы
 * несколько инстансов Next.js / WS-gateway видели одних и тех же
 * «онлайн»-меток.
 *
 * `snapshot()` стал async: объединяет память процесса и (опционально)
 * Redis `MGET` по переданному списку user ids.
 */

import { getRedis } from "@/lib/redis";

export interface PresenceSnapshot {
  /** Все пользователи, известные регистру (онлайн + недавно офлайн). */
  entries: Array<{ userId: string; lastSeen: number }>;
  /** Те, кто «онлайн» по DEFAULT_WINDOW_MS. */
  online: Set<string>;
  generatedAt: number;
}

const DEFAULT_WINDOW_MS = 60_000;
const GC_EVERY_MS = 5 * 60_000;
const GC_OLDER_THAN_MS = 30 * 60_000;
const REDIS_PREFIX = "krwn:presence:";
const REDIS_TTL_SEC = 120;

interface PresenceStore {
  lastSeen: Map<string, number>;
  lastGc: number;
}

const globalForPresence = globalThis as unknown as {
  __krwnPresence?: PresenceStore;
};

function isRedisPresenceEnabled(): boolean {
  return !!(process.env.REDIS_URL?.trim() && process.env.KRWN_PRESENCE_REDIS !== "0");
}

function store(): PresenceStore {
  if (!globalForPresence.__krwnPresence) {
    globalForPresence.__krwnPresence = {
      lastSeen: new Map(),
      lastGc: Date.now(),
    };
  }
  return globalForPresence.__krwnPresence;
}

function gc(now: number): void {
  const s = store();
  if (now - s.lastGc < GC_EVERY_MS) return;
  s.lastGc = now;
  for (const [userId, ts] of s.lastSeen) {
    if (now - ts > GC_OLDER_THAN_MS) s.lastSeen.delete(userId);
  }
}

function redisTouch(userId: string, at: number): void {
  if (!isRedisPresenceEnabled()) return;
  void getRedis()
    .set(`${REDIS_PREFIX}${userId}`, String(at), "EX", REDIS_TTL_SEC)
    .catch(() => {});
}

function redisLeave(userId: string): void {
  if (!isRedisPresenceEnabled()) return;
  void getRedis().del(`${REDIS_PREFIX}${userId}`).catch(() => {});
}

/** Освежить метку «был онлайн» для пользователя. */
export function touch(userId: string, at: number = Date.now()): void {
  if (!userId) return;
  store().lastSeen.set(userId, at);
  gc(at);
  redisTouch(userId, at);
}

/** Немедленно убрать пользователя из онлайна (SSE/WS-коннект закрыт). */
export function leave(userId: string): void {
  if (!userId) return;
  store().lastSeen.set(userId, Date.now() - GC_OLDER_THAN_MS - 1);
  redisLeave(userId);
}

/** Онлайн ли конкретный пользователь (в пределах окна), только по памяти процесса. */
export function isOnline(
  userId: string,
  windowMs: number = DEFAULT_WINDOW_MS,
  now: number = Date.now(),
): boolean {
  const ts = store().lastSeen.get(userId);
  if (!ts) return false;
  return now - ts <= windowMs;
}

/**
 * Срез presence. При Redis и непустом `userIds` подмешивает `MGET`.
 */
export async function snapshot(
  userIds?: Iterable<string>,
  windowMs: number = DEFAULT_WINDOW_MS,
  now: number = Date.now(),
): Promise<PresenceSnapshot> {
  const filter = userIds ? new Set(userIds) : null;
  const merged = new Map<string, number>();

  const s = store();
  gc(now);
  for (const [userId, ts] of s.lastSeen) {
    if (filter && !filter.has(userId)) continue;
    merged.set(userId, ts);
  }

  if (isRedisPresenceEnabled() && filter && filter.size > 0) {
    try {
      const r = getRedis();
      const ids = [...filter];
      const keys = ids.map((id) => `${REDIS_PREFIX}${id}`);
      if (keys.length > 0) {
        const vals = await r.mget(...keys);
        for (let i = 0; i < ids.length; i++) {
          const id = ids[i];
          if (!id) continue;
          const v = vals[i];
          if (v == null) continue;
          const ts = Number(v);
          if (!Number.isFinite(ts)) continue;
          const prev = merged.get(id);
          merged.set(id, prev == null ? ts : Math.max(prev, ts));
        }
      }
    } catch {
      /* fail soft */
    }
  }

  const entries: Array<{ userId: string; lastSeen: number }> = [];
  const online = new Set<string>();
  for (const [userId, lastSeen] of merged) {
    entries.push({ userId, lastSeen });
    if (now - lastSeen <= windowMs) online.add(userId);
  }

  return { entries, online, generatedAt: now };
}

/** Полный сброс — только для тестов. */
export function _resetForTests(): void {
  store().lastSeen.clear();
  store().lastGc = Date.now();
}

export const PRESENCE_WINDOW_MS = DEFAULT_WINDOW_MS;
