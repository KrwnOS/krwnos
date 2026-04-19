/**
 * KrwnOS WebSocket realtime gateway (Horizon 1 — Realtime).
 *
 * Subscribes to Redis `PSUBSCRIBE krwn:events:*` (same namespace as
 * `RedisEventBus`) and pushes filtered events to authenticated browser
 * sessions. Run alongside Next.js when `REDIS_URL` is set.
 *
 *   npm run ws:gateway
 *
 * Env:
 *   REDIS_URL          — required for cross-process pub/sub
 *   KRWN_WS_PORT       — listen port (default 3010)
 *   KRWN_WS_HOST       — bind address (default 0.0.0.0)
 */
import type { IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import Redis from "ioredis";
import {
  ACTIVITY_EVENTS,
  type ActivityRecordedEvent,
  isActivityEntryVisibleToViewer,
} from "@/core";
import {
  CHAT_EVENTS,
  type ChatDirectiveAckedEvent,
  type ChatMessageCreatedEvent,
} from "@/modules/chat";
import { resolveRealtimeSession, type RealtimeSession } from "@/realtime/resolve-session";

const PORT = Number(process.env.KRWN_WS_PORT ?? 3010);
const HOST = process.env.KRWN_WS_HOST ?? "0.0.0.0";
const REDIS_URL = process.env.REDIS_URL?.trim();
const CHANNEL_PREFIX = "krwn:events:";

interface Client {
  ws: WebSocket;
  session: RealtimeSession;
}

const clients = new Set<Client>();

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[ws-gateway] ${new Date().toISOString()} ${msg}`);
}

function shouldDeliver(
  session: RealtimeSession,
  eventName: string,
  payload: unknown,
): boolean {
  if (eventName === CHAT_EVENTS.MessageCreated) {
    const e = payload as ChatMessageCreatedEvent;
    if (!e || e.stateId !== session.stateId) return false;
    if (session.isOwner) return true;
    return e.recipientUserIds.includes(session.userId);
  }
  if (eventName === CHAT_EVENTS.DirectiveAcknowledged) {
    const e = payload as ChatDirectiveAckedEvent;
    if (!e || e.stateId !== session.stateId) return false;
    if (session.isOwner) return true;
    if (e.ack.userId === session.userId) return true;
    return e.recipientUserIds.includes(session.userId);
  }
  if (eventName === ACTIVITY_EVENTS.Recorded) {
    const e = payload as ActivityRecordedEvent;
    if (!e?.entry) return false;
    return isActivityEntryVisibleToViewer(e.entry, session.viewer);
  }
  return false;
}

function broadcast(eventName: string, payload: unknown): void {
  const wire = JSON.stringify({ event: eventName, data: payload });
  for (const c of clients) {
    if (!shouldDeliver(c.session, eventName, payload)) continue;
    if (c.ws.readyState === WebSocket.OPEN) {
      try {
        c.ws.send(wire);
      } catch {
        /* ignore */
      }
    }
  }
}

async function main(): Promise<void> {
  if (!REDIS_URL) {
    log("REDIS_URL is not set — WebSocket gateway requires Redis pub/sub. Exiting.");
    process.exit(1);
  }

  const sub = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  await sub.psubscribe(`${CHANNEL_PREFIX}*`);

  sub.on("pmessage", (_pattern: string, channel: string, message: string) => {
    if (!channel.startsWith(CHANNEL_PREFIX)) return;
    const eventName = channel.slice(CHANNEL_PREFIX.length);
    let payload: unknown;
    try {
      payload = JSON.parse(message);
    } catch {
      payload = message;
    }
    broadcast(eventName, payload);
  });

  const wss = new WebSocketServer({ host: HOST, port: PORT });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    let token = "";
    try {
      const host = req.headers.host ?? "localhost";
      const u = new URL(req.url ?? "/", `http://${host}`);
      token = u.searchParams.get("token")?.trim() ?? "";
    } catch {
      token = "";
    }
    if (!token) {
      ws.close(4401, "missing token");
      return;
    }

    void resolveRealtimeSession(token)
      .then((session) => {
        const client: Client = { ws, session };
        clients.add(client);
        ws.send(
          JSON.stringify({
            event: "__ready__",
            data: {
              userId: session.userId,
              stateId: session.stateId,
              at: new Date().toISOString(),
            },
          }),
        );
        const onClose = () => {
          clients.delete(client);
        };
        ws.on("close", onClose);
        ws.on("error", onClose);
      })
      .catch(() => {
        ws.close(4403, "unauthorized");
      });
  });

  wss.on("listening", () => {
    log(`listening on ws://${HOST}:${PORT} (redis: ${REDIS_URL})`);
  });

  const shutdown = async (signal: string) => {
    log(`received ${signal}, shutting down…`);
    wss.close();
    await sub.quit().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[ws-gateway] fatal:", err);
  process.exit(1);
});
