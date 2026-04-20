/**
 * Activity Feed bootstrap.
 * ------------------------------------------------------------
 * Next.js initialises modules lazily per-request, и у нас нет
 * «единой точки старта». Вместо того чтобы городить `instrumentation.ts`,
 * мы используем паттерн «идемпотентного синглтона»:
 *
 *   * Первый импорт файла на сервере создаёт `ActivityFeedService`
 *     поверх Prisma-репозитория и подписывает его на Event Bus.
 *   * Для HMR-safety храним ссылку в `globalThis` — тот же трюк,
 *     что и в `src/lib/prisma.ts`.
 *   * Любой API-роут, который может генерировать события
 *     (wallet / chat / governance / state), импортирует этот модуль
 *     — так подписчики гарантированно подняты ДО того, как первый
 *     EventBus.emit()` уедет впустую.
 *
 * Вызывающие используют `getActivityFeed()` вместо `new`.
 */

import { eventBus } from "@/core";
import {
  ActivityFeedService,
  createPrismaActivityRepository,
  subscribeActivityFeed,
} from "@/core";
import { prisma } from "@/lib/prisma";
// Web Push bus handlers (directive ACK, governance votes).
import "@/server/push-boot";

interface CachedFeed {
  service: ActivityFeedService;
  off: () => void;
}

const globalForActivity = globalThis as unknown as {
  __krwnActivityFeed?: CachedFeed;
};

export function getActivityFeed(): ActivityFeedService {
  if (!globalForActivity.__krwnActivityFeed) {
    const service = new ActivityFeedService({
      repo: createPrismaActivityRepository(prisma),
      bus: eventBus,
    });
    const off = subscribeActivityFeed(eventBus, service);
    globalForActivity.__krwnActivityFeed = { service, off };
  }
  return globalForActivity.__krwnActivityFeed.service;
}
