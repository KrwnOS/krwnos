/**
 * GET /api/chat/stream — server-sent events for realtime chat.
 *
 * Subscribes to the `core.chat.message.created` event on the kernel
 * event bus and forwards each event to the connected client only if
 * they are listed in `recipientUserIds` (which the ChatService
 * populated from the channel's node membership + ancestors).
 *
 * When the bus is a `RedisEventBus`, events originating on other
 * workers reach this handler via Redis pub/sub — which is exactly
 * why the user asked for a Redis-backed bus.
 */

import type { NextRequest } from "next/server";
import { eventBus } from "@/core";
import {
  CHAT_EVENTS,
  type ChatDirectiveAckedEvent,
  type ChatMessageCreatedEvent,
} from "@/modules/chat";
import { loadChatContext, chatErrorResponse } from "../_context";

// SSE + long-lived Redis subscriptions need Node.js runtime, not Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  let ctx;
  try {
    ctx = await loadChatContext(req);
  } catch (err) {
    return chatErrorResponse(err);
  }

  const { access, stateId } = ctx;

  const encoder = new TextEncoder();
  let offMessage: (() => void) | null = null;
  let offDirective: (() => void) | null = null;
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

      send("ready", { userId: access.userId, at: new Date().toISOString() });

      offMessage = eventBus.on<ChatMessageCreatedEvent>(
        CHAT_EVENTS.MessageCreated,
        (evt) => {
          if (!evt) return;
          if (!isRecipient(evt, access.userId, access.isOwner)) return;
          send("message", evt);
        },
      );

      offDirective = eventBus.on<ChatDirectiveAckedEvent>(
        CHAT_EVENTS.DirectiveAcknowledged,
        (evt) => {
          if (!evt || evt.stateId !== stateId) return;
          if (access.isOwner) {
            send("directive-ack", evt);
            return;
          }
          if (evt.ack.userId === access.userId) {
            send("directive-ack", evt);
            return;
          }
          if (evt.recipientUserIds.includes(access.userId)) {
            send("directive-ack", evt);
          }
        },
      );

      // SSE proxies (nginx, Cloudflare) drop idle connections; ping keeps it warm.
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
        if (offMessage) offMessage();
        if (offDirective) offDirective();
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
      if (offMessage) offMessage();
      if (offDirective) offDirective();
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

function isRecipient(
  evt: ChatMessageCreatedEvent,
  userId: string,
  isOwner: boolean,
): boolean {
  if (isOwner) return true;
  return evt.recipientUserIds.includes(userId);
}
