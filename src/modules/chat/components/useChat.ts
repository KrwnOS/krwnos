/**
 * useChat — client-side state + transport for the chat UI.
 * ------------------------------------------------------------
 * Wires the UI to the `/api/chat/*` routes we built in phase 1:
 *
 *   * REST via `fetch()` with a Bearer token read from
 *     `localStorage["krwn.token"]`. The UI shows a small "connect"
 *     form when no token is configured.
 *
 *   * Realtime via `EventSource`. Because native EventSource can't
 *     set headers, the token is passed as a `?token=` query string —
 *     supported server-side by the extended `authenticateCli`.
 *
 * The hook intentionally holds ALL chat state in a single component
 * tree (no redux, no zustand) so integrating the widget into any page
 * is a one-liner. The shape returned from `useChat()` is stable and
 * easy to memoise.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChannelAccessInfo,
  ChatChannel,
  ChatDirectiveAck,
  ChatDirectiveAckedEvent,
  ChatMessage,
  ChatMessageCreatedEvent,
  PendingDirective,
} from "../service";
import { CHAT_EVENTS } from "../service";

const TOKEN_STORAGE_KEY = "krwn.token";

export interface ChatApiError {
  status: number;
  message: string;
}

export interface ChatIdentity {
  userId: string;
  isOwner: boolean;
}

export interface UseChatReturn {
  token: string | null;
  setToken: (next: string | null) => void;

  loading: boolean;
  error: ChatApiError | null;
  me: ChatIdentity | null;

  channels: ChannelAccessInfo[];
  activeChannelId: string | null;
  setActiveChannel: (channelId: string) => void;

  messagesByChannel: Record<string, ChatMessage[]>;
  pendingAcksByMessage: Record<string, ChatDirectiveAck[]>;

  pendingDirectives: PendingDirective[];

  sendMessage: (body: string, asDirective: boolean) => Promise<void>;
  acknowledge: (messageId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useChat(): UseChatReturn {
  const [token, setTokenState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ChatApiError | null>(null);
  const [me, setMe] = useState<ChatIdentity | null>(null);
  const [channels, setChannels] = useState<ChannelAccessInfo[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [messagesByChannel, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [pendingAcksByMessage, setAcks] = useState<Record<string, ChatDirectiveAck[]>>({});
  const [pendingDirectives, setPendingDirectives] = useState<PendingDirective[]>([]);

  // ----- Token management ---------------------------------
  const setToken = useCallback((next: string | null) => {
    if (typeof window !== "undefined") {
      if (next) window.localStorage.setItem(TOKEN_STORAGE_KEY, next);
      else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
    setTokenState(next);
  }, []);

  // ----- REST helper --------------------------------------
  const apiFetch = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      if (!token) throw new Error("no-token");
      const res = await fetch(path, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw Object.assign(new Error(text || res.statusText), {
          status: res.status,
        });
      }
      return (await res.json()) as T;
    },
    [token],
  );

  // ----- Data loaders -------------------------------------
  const loadChannels = useCallback(async () => {
    const data = await apiFetch<{
      channels: ChannelAccessInfo[];
      me: ChatIdentity;
    }>("/api/chat/channels");
    setChannels(data.channels);
    setMe(data.me ?? null);
    return data.channels;
  }, [apiFetch]);

  const loadMessages = useCallback(
    async (channelId: string) => {
      const data = await apiFetch<{ messages: ChatMessage[] }>(
        `/api/chat/channels/${channelId}/messages`,
      );
      setMessages((prev) => ({ ...prev, [channelId]: data.messages }));
    },
    [apiFetch],
  );

  const loadPending = useCallback(async () => {
    const data = await apiFetch<{ pending: PendingDirective[] }>(
      "/api/chat/directives/pending",
    );
    setPendingDirectives(data.pending);
  }, [apiFetch]);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const cs = await loadChannels();
      await loadPending();
      const firstId = cs[0]?.channel.id ?? null;
      setActiveChannelId((current) => current ?? firstId);
      if (firstId && !messagesByChannel[firstId]) {
        await loadMessages(firstId);
      }
    } catch (err) {
      setError(asApiError(err));
    } finally {
      setLoading(false);
    }
  }, [token, loadChannels, loadPending, loadMessages, messagesByChannel]);

  // Initial load whenever the token changes.
  useEffect(() => {
    if (token) void refresh();
    else {
      setChannels([]);
      setMessages({});
      setPendingDirectives([]);
      setActiveChannelId(null);
      setMe(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Auto-load messages when a new channel is selected.
  useEffect(() => {
    if (!activeChannelId) return;
    if (messagesByChannel[activeChannelId]) return;
    void loadMessages(activeChannelId).catch((err) => setError(asApiError(err)));
  }, [activeChannelId, loadMessages, messagesByChannel]);

  // ----- Realtime (WebSocket gateway → SSE fallback) -----
  const esRef = useRef<EventSource | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!token) return;

    const applyMessageEvent = (evt: ChatMessageCreatedEvent) => {
      setMessages((prev) => {
        const list = prev[evt.channelId] ?? [];
        if (list.some((m) => m.id === evt.message.id)) return prev;
        return { ...prev, [evt.channelId]: [...list, evt.message] };
      });
      if (evt.directiveAcks.length) {
        setAcks((prev) => ({
          ...prev,
          [evt.message.id]: evt.directiveAcks,
        }));
        void loadPending().catch(() => {});
      }
    };

    const applyDirectiveAck = (evt: ChatDirectiveAckedEvent) => {
      setAcks((prev) => {
        const list = prev[evt.messageId] ?? [];
        const next = list.map((a) =>
          a.userId === evt.ack.userId ? evt.ack : a,
        );
        return { ...prev, [evt.messageId]: next };
      });
    };

    const wsBase = process.env.NEXT_PUBLIC_KRWN_WS_URL?.trim();
    let cleaned = false;
    let es: EventSource | null = null;

    const startSse = () => {
      if (cleaned) return;
      const url = `/api/chat/stream?token=${encodeURIComponent(token)}`;
      const source = new EventSource(url);
      es = source;
      esRef.current = source;
      wsRef.current = null;

      source.addEventListener("message", (ev) => {
        try {
          applyMessageEvent(JSON.parse(ev.data) as ChatMessageCreatedEvent);
        } catch {
          /* swallow */
        }
      });

      source.addEventListener("directive-ack", (ev) => {
        try {
          applyDirectiveAck(
            JSON.parse((ev as MessageEvent).data) as ChatDirectiveAckedEvent,
          );
        } catch {
          /* ignore */
        }
      });

      source.onerror = () => {
        /* EventSource reconnects automatically */
      };
    };

    if (wsBase) {
      const u = `${wsBase.replace(/\/$/, "")}/?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(u);
      wsRef.current = ws;
      esRef.current = null;
      let fellBack = false;

      ws.onmessage = (me) => {
        try {
          const msg = JSON.parse(me.data as string) as {
            event: string;
            data: unknown;
          };
          if (msg.event === "__ready__") return;
          if (msg.event === CHAT_EVENTS.MessageCreated) {
            applyMessageEvent(msg.data as ChatMessageCreatedEvent);
          } else if (msg.event === CHAT_EVENTS.DirectiveAcknowledged) {
            applyDirectiveAck(msg.data as ChatDirectiveAckedEvent);
          }
        } catch {
          /* ignore */
        }
      };

      ws.onerror = () => {
        if (cleaned || fellBack) return;
        fellBack = true;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        wsRef.current = null;
        startSse();
      };

      return () => {
        cleaned = true;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        es?.close();
        wsRef.current = null;
        esRef.current = null;
      };
    }

    startSse();
    return () => {
      cleaned = true;
      es?.close();
      esRef.current = null;
    };
  }, [token, loadPending]);

  // ----- Mutations ----------------------------------------
  const sendMessage = useCallback(
    async (body: string, asDirective: boolean) => {
      if (!activeChannelId) return;
      const path = asDirective
        ? `/api/chat/channels/${activeChannelId}/directives`
        : `/api/chat/channels/${activeChannelId}/messages`;
      await apiFetch<{ message: ChatMessage }>(path, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      // The SSE event will populate the list; no optimistic insert
      // needed so we don't risk duplicates on fast networks.
    },
    [activeChannelId, apiFetch],
  );

  const acknowledge = useCallback(
    async (messageId: string) => {
      await apiFetch<{ ack: ChatDirectiveAck }>(
        `/api/chat/messages/${messageId}/ack`,
        { method: "POST" },
      );
      setPendingDirectives((prev) => prev.filter((p) => p.message.id !== messageId));
    },
    [apiFetch],
  );

  const api = useMemo<UseChatReturn>(
    () => ({
      token,
      setToken,
      loading,
      error,
      me,
      channels,
      activeChannelId,
      setActiveChannel: (id) => setActiveChannelId(id),
      messagesByChannel,
      pendingAcksByMessage,
      pendingDirectives,
      sendMessage,
      acknowledge,
      refresh,
    }),
    [
      token,
      setToken,
      loading,
      error,
      me,
      channels,
      activeChannelId,
      messagesByChannel,
      pendingAcksByMessage,
      pendingDirectives,
      sendMessage,
      acknowledge,
      refresh,
    ],
  );

  return api;
}

function asApiError(err: unknown): ChatApiError {
  if (err && typeof err === "object" && "status" in err) {
    const e = err as { status?: number; message?: string };
    return { status: e.status ?? 500, message: e.message ?? "request failed" };
  }
  return { status: 500, message: err instanceof Error ? err.message : "unknown error" };
}

/**
 * Groups channels according to the sidebar specification:
 *   * Общие          — public (unbound) channels
 *   * Мой отдел      — channels bound to a node the user is a direct member of
 *   * Прямые связи   — channels reachable via inheritance (ancestor membership)
 *   * Иное           — anything we couldn't classify (sovereign-only leftovers)
 *
 * Kept here as a pure function so both the sidebar and future tests
 * can call it without pulling in React state.
 */
export function groupChannels(infos: ChannelAccessInfo[]): {
  general: ChannelAccessInfo[];
  department: ChannelAccessInfo[];
  direct: ChannelAccessInfo[];
  other: ChannelAccessInfo[];
} {
  const out = {
    general: [] as ChannelAccessInfo[],
    department: [] as ChannelAccessInfo[],
    direct: [] as ChannelAccessInfo[],
    other: [] as ChannelAccessInfo[],
  };
  for (const info of infos) {
    switch (info.accessReason) {
      case "public":
        out.general.push(info);
        break;
      case "direct":
        out.department.push(info);
        break;
      case "inherited":
        out.direct.push(info);
        break;
      default:
        out.other.push(info);
    }
  }
  return out;
}

// Re-export so consumers only need one import path.
export type { ChatChannel };
