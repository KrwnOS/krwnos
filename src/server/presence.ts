/**
 * Presence registry (кто сейчас онлайн).
 * ------------------------------------------------------------
 * В KrwnOS нет отдельного presence-сервиса (Matrix / XMPP / …)
 * — мы используем простой in-memory словарь `userId → lastSeen`,
 * который обновляется двумя триггерами:
 *
 *   1. Клиент держит SSE-коннект к `/api/activity/stream`. Пока
 *      коннект жив, SSE-роут зовёт `presence.touch(userId)`
 *      на каждом heartbeat (раз в 25 с).
 *   2. Любой аутентифицированный HTTP-запрос может вручную
 *      вызвать `touch(userId)` — например, пулинг `/api/state/pulse`
 *      из сайдбара дашборда.
 *
 * Пользователь считается онлайн, если его `lastSeen` не старше
 * `DEFAULT_WINDOW_MS` (60 секунд — чуть больше интервала SSE-
 * heartbeat, чтобы случайная потеря одного пинга не гасила метку).
 *
 * Почему НЕ Redis и не БД:
 *   * KrwnOS разворачивается на маленьких сингл-нод-хостингах (20i
 *     и т.п.), где нет гарантированного Redis. Для presence нам
 *     достаточно «в рамках одного процесса» — кросс-инстансный
 *     online-статус — это задача следующего релиза.
 *   * БД писать 1..N раз в минуту на каждого онлайнового
 *     гражданина — заметная нагрузка, а ценность presence-истории
 *     невысока (сохранять её смысла нет).
 *
 * HMR-safety: ссылка живёт в `globalThis.__krwnPresence`, чтобы
 * горячая перезагрузка Next-а в dev-режиме не обнуляла состояние.
 */

export interface PresenceSnapshot {
  /** Все пользователи, известные регистру (онлайн + недавно офлайн). */
  entries: Array<{ userId: string; lastSeen: number }>;
  /** Те, кто «онлайн» по DEFAULT_WINDOW_MS. */
  online: Set<string>;
  generatedAt: number;
}

const DEFAULT_WINDOW_MS = 60_000;
// Очистка старых меток — чтобы Map не тёк при большом перекуре
// граждан, которые давно ушли.
const GC_EVERY_MS = 5 * 60_000;
const GC_OLDER_THAN_MS = 30 * 60_000;

interface PresenceStore {
  lastSeen: Map<string, number>;
  lastGc: number;
}

const globalForPresence = globalThis as unknown as {
  __krwnPresence?: PresenceStore;
};

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

/** Освежить метку «был онлайн» для пользователя. */
export function touch(userId: string, at: number = Date.now()): void {
  if (!userId) return;
  store().lastSeen.set(userId, at);
  gc(at);
}

/** Немедленно убрать пользователя из онлайна (SSE-коннект закрыт). */
export function leave(userId: string): void {
  if (!userId) return;
  // Ставим метку на "позавчера" — тот же эффект, но сохраняем
  // единую логику DEFAULT_WINDOW_MS; удаление приведёт к тому же,
  // но в будущем может понадобиться «был видел 5 минут назад».
  store().lastSeen.set(userId, Date.now() - GC_OLDER_THAN_MS - 1);
}

/** Онлайн ли конкретный пользователь (в пределах окна). */
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
 * Срез presence на данный момент. Если передан `userIds` — фильтрует
 * только по ним (удобно, когда UI получил список граждан из Prisma
 * и хочет обогатить его флагом `online`).
 */
export function snapshot(
  userIds?: Iterable<string>,
  windowMs: number = DEFAULT_WINDOW_MS,
  now: number = Date.now(),
): PresenceSnapshot {
  const s = store();
  const online = new Set<string>();
  const entries: Array<{ userId: string; lastSeen: number }> = [];

  const filter = userIds ? new Set(userIds) : null;

  for (const [userId, ts] of s.lastSeen) {
    if (filter && !filter.has(userId)) continue;
    entries.push({ userId, lastSeen: ts });
    if (now - ts <= windowMs) online.add(userId);
  }

  return { entries, online, generatedAt: now };
}

/** Полный сброс — только для тестов. */
export function _resetForTests(): void {
  store().lastSeen.clear();
  store().lastGc = Date.now();
}

export const PRESENCE_WINDOW_MS = DEFAULT_WINDOW_MS;
