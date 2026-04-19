/**
 * GET /api/activity/stream — SSE-поток «Пульса Государства».
 *
 * Подписывается на `core.activity.recorded` в Event Bus и
 * пушит каждую новую строку клиенту, если она проходит
 * фильтр `ActivityFeedService.isVisibleTo(viewer)`.
 *
 * Бэкенд — RedisEventBus в проде, InMemoryEventBus в dev. Оба
 * одинаково работают через `eventBus.on(...)`, так что код
 * SSE-потока один.
 */

import type { NextRequest } from "next/server";
import { eventBus } from "@/core";
import {
  ACTIVITY_EVENTS,
  type ActivityRecordedEvent,
} from "@/core";
import {
  activityErrorResponse,
  loadActivityContext,
} from "../_context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  let ctx;
  try {
    ctx = await loadActivityContext(req);
  } catch (err) {
    return activityErrorResponse(err);
  }

  const { service, viewer } = ctx;
  const encoder = new TextEncoder();
  let offRecord: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          cleanup();
        }
      };

      send("ready", {
        userId: viewer.userId,
        isOwner: viewer.isOwner,
        at: new Date().toISOString(),
      });

      offRecord = eventBus.on<ActivityRecordedEvent>(
        ACTIVITY_EVENTS.Recorded,
        (evt) => {
          if (!evt || !evt.entry) return;
          if (!service.isVisibleTo(evt.entry, viewer)) return;
          send("activity", evt.entry);
        },
      );

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: keep-alive ${Date.now()}\n\n`));
        } catch {
          cleanup();
        }
      }, 25_000);

      req.signal.addEventListener("abort", cleanup);

      function cleanup() {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (offRecord) offRecord();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (offRecord) offRecord();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
