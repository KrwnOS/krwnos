/**
 * `/dashboard` — Пульс Государства (State Pulse).
 * ------------------------------------------------------------
 * Главный экран гражданина. Трёхколоночный layout + оверлеи:
 *
 *   ┌───────────────────────────────────────────────────────────┐
 *   │ Header: роль в Вертикали + баланс + [Огласить] (Суверен)  │
 *   ├──────────────────────────┬────────────────────────────────┤
 *   │ Center: Activity Feed    │ Sidebar: дерево власти         │
 *   │  - live SSE-обновление   │  - клик по узлу → drawer       │
 *   │  - фильтры по категориям │  - счётчики онлайна            │
 *   └──────────────────────────┴────────────────────────────────┘
 *   Overlays: ToastStack (push-уведомления), BroadcastModal,
 *             NodeDetailDrawer.
 *
 * Данные:
 *   * `/api/activity` + `/api/activity/stream` — лента событий
 *     с visibility-фильтрацией (см. docstring в роутах).
 *   * `/api/state/pulse` — единый BFF-endpoint: viewer, роль-путь,
 *     баланс, дерево + онлайн-флаги. Пулится раз в 15с, чтобы
 *     presence-индикаторы оставались свежими.
 *   * `POST /api/activity/broadcast` — Суверенский указ (появляется
 *     всем как toast и запись в ленте).
 *
 * Push-уведомления: SSE-поток распознаёт high-priority события
 * (`metadata.broadcast=true` | `metadata.priority="high"` |
 * `event="core.broadcast.sovereign"`) и:
 *   1. Поднимает toast в правом нижнем углу (~10с).
 *   2. Если пользователь разрешил Notifications API — вызывает
 *      native system notification (работает даже если вкладка в
 *      фоне).
 *
 * Вся копирайтинговая часть живёт под ключами `pulse.*` в
 * locales; UI-названия событий — под `pulse.event.*`.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { ACTIVITY_EVENTS } from "@/core/activity-events";
import { formatAmount, KRONA_SYMBOL } from "@/components/wallet";

// ------------------------------------------------------------
// Wire types
// ------------------------------------------------------------

type ActivityCategory =
  | "wallet"
  | "chat"
  | "governance"
  | "state"
  | "kernel"
  | "exchange"
  | string;

interface ActivityEntry {
  id: string;
  stateId: string;
  event: string;
  category: ActivityCategory;
  titleKey: string;
  titleParams: Record<string, unknown>;
  actorId: string | null;
  nodeId: string | null;
  visibility: string;
  audienceUserIds: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface FeedPage {
  stateId: string;
  viewer: { userId: string; isOwner: boolean; scopeNodeIds: string[] };
  entries: ActivityEntry[];
  nextBefore: string | null;
}

type NodeType = "position" | "department" | "rank";

interface PulseNode {
  id: string;
  parentId: string | null;
  title: string;
  type: NodeType;
  order: number;
  isLobby: boolean;
  memberCount: number;
  onlineCount: number;
}

interface PulseMember {
  userId: string;
  nodeId: string;
  handle: string;
  displayName: string | null;
  online: boolean;
  isSelf: boolean;
}

interface PulseContext {
  viewer: {
    userId: string;
    handle: string;
    displayName: string | null;
    isOwner: boolean;
    isLobbyOnly: boolean;
    /** Present on newer API; fall back to isOwner. */
    canAuditLog?: boolean;
  };
  state: { id: string; slug: string; name: string };
  role: {
    primaryNodeId: string | null;
    nodeIds: string[];
    path: Array<{ id: string; title: string; type: NodeType }>;
  };
  wallet: { address: string; balance: number; currency: string } | null;
  tree: {
    nodes: PulseNode[];
    members: PulseMember[];
    onlineUserIds: string[];
  };
  presenceWindowMs: number;
}

// ------------------------------------------------------------
// Constants
// ------------------------------------------------------------

const TOKEN_STORAGE_KEY = "krwn.token";
// WalletWidget в navbar использует другой ключ; держим оба
// синхронизированными, чтобы залогиненность не разваливалась.
const LEGACY_WALLET_TOKEN_KEY = "krwn.cli_token";
const FILTER_KEYS = [
  "all",
  "wallet",
  "chat",
  "governance",
  "state",
  "kernel",
] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

const PULSE_CTX_REFRESH_MS = 15_000;

// ------------------------------------------------------------
// Page
// ------------------------------------------------------------

export default function DashboardPage() {
  const { t } = useI18n();
  const [token, setToken] = useState<string | null>(null);

  // Feed state
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [liveConnected, setLiveConnected] = useState(false);

  // Pulse context (viewer / role / wallet / tree)
  const [ctx, setCtx] = useState<PulseContext | null>(null);
  const [ctxError, setCtxError] = useState<string | null>(null);

  // --- Push-уведомления + broadcast + node drawer ---
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [drawerNodeId, setDrawerNodeId] = useState<string | null>(null);
  // Notifications permission — спрашиваем один раз после логина.
  const notifyRequestedRef = useRef(false);

  // Bootstrap token from localStorage.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const primary = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    const legacy = window.localStorage.getItem(LEGACY_WALLET_TOKEN_KEY);
    setToken(primary ?? legacy);
  }, []);

  // -------- Feed: initial & filter-change reload --------
  const loadInitial = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      qs.set("limit", "50");
      if (filter !== "all") qs.set("category", filter);
      const res = await fetch(`/api/activity?${qs.toString()}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = (await res.json()) as FeedPage | { error: unknown };
      if (!res.ok || !("entries" in body)) {
        throw new Error(
          "error" in body
            ? typeof body.error === "string"
              ? body.error
              : JSON.stringify(body.error)
            : `HTTP ${res.status}`,
        );
      }
      setEntries(body.entries);
      setNextBefore(body.nextBefore);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setLoading(false);
    }
  }, [token, filter]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const loadMore = useCallback(async () => {
    if (!token || !nextBefore) return;
    setLoadingMore(true);
    try {
      const qs = new URLSearchParams();
      qs.set("limit", "50");
      qs.set("before", nextBefore);
      if (filter !== "all") qs.set("category", filter);
      const res = await fetch(`/api/activity?${qs.toString()}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = (await res.json()) as FeedPage | { error: unknown };
      if (!res.ok || !("entries" in body)) return;
      setEntries((prev) => [...prev, ...body.entries]);
      setNextBefore(body.nextBefore);
    } finally {
      setLoadingMore(false);
    }
  }, [token, nextBefore, filter]);

  // -------- Feed: WebSocket gateway → SSE fallback --------
  const esRef = useRef<EventSource | null>(null);
  useEffect(() => {
    if (!token) return;

    const ingestEntry = (entry: ActivityEntry) => {
      setEntries((prev) => {
        if (prev.some((e) => e.id === entry.id)) return prev;
        if (filter !== "all" && entry.category !== filter) return prev;
        return [entry, ...prev];
      });
      if (isHighPriorityEntry(entry)) {
        pushToast(setToasts, entry);
        tryWebNotify(entry);
      }
    };

    const onReady = () => setLiveConnected(true);
    const onActivity = (ev: MessageEvent<string>) => {
      try {
        ingestEntry(JSON.parse(ev.data) as ActivityEntry);
      } catch {
        /* ignore malformed frame */
      }
    };
    const onError = () => setLiveConnected(false);

    const wsBase = process.env.NEXT_PUBLIC_KRWN_WS_URL?.trim();
    let cleaned = false;
    let es: EventSource | null = null;

    const startSse = () => {
      if (cleaned) return;
      const source = new EventSource(
        `/api/activity/stream?token=${encodeURIComponent(token)}`,
      );
      es = source;
      esRef.current = source;
      source.addEventListener("ready", onReady);
      source.addEventListener("activity", onActivity as EventListener);
      source.onerror = onError;
    };

    if (wsBase) {
      const u = `${wsBase.replace(/\/$/, "")}/?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(u);
      esRef.current = null;
      let fellBack = false;

      ws.onopen = () => setLiveConnected(true);
      ws.onmessage = (me) => {
        try {
          const msg = JSON.parse(me.data as string) as {
            event: string;
            data: unknown;
          };
          if (msg.event === "__ready__") {
            setLiveConnected(true);
            return;
          }
          if (msg.event === ACTIVITY_EVENTS.Recorded) {
            const entry = (msg.data as { entry: ActivityEntry }).entry;
            if (entry) ingestEntry(entry);
          }
        } catch {
          /* ignore */
        }
      };
      ws.onerror = () => {
        setLiveConnected(false);
        if (cleaned || fellBack) return;
        fellBack = true;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        startSse();
      };

      return () => {
        cleaned = true;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        es?.removeEventListener("ready", onReady);
        es?.removeEventListener("activity", onActivity as EventListener);
        es?.close();
        esRef.current = null;
        setLiveConnected(false);
      };
    }

    startSse();
    return () => {
      cleaned = true;
      es?.removeEventListener("ready", onReady);
      es?.removeEventListener("activity", onActivity as EventListener);
      es?.close();
      esRef.current = null;
      setLiveConnected(false);
    };
  }, [token, filter]);

  // -------- Pulse context: initial + polled refresh --------
  const loadCtx = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/state/pulse", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const body = (await res.json()) as PulseContext | { error: unknown };
      if (!res.ok || !("viewer" in body)) {
        const msg =
          "error" in body
            ? typeof body.error === "string"
              ? body.error
              : JSON.stringify(body.error)
            : `HTTP ${res.status}`;
        setCtxError(msg);
        return;
      }
      setCtx(body);
      setCtxError(null);
    } catch (err) {
      setCtxError(err instanceof Error ? err.message : "unknown error");
    }
  }, [token]);

  useEffect(() => {
    void loadCtx();
    if (!token) return;
    const id = window.setInterval(() => void loadCtx(), PULSE_CTX_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [loadCtx, token]);

  // Разово просим permission на Web Notifications. Браузеры
  // требуют user-gesture context — поэтому прячем запрос за
  // `visibilitychange` (пользователь открыл вкладку осознанно)
  // или первое успешное ctx-получение. Повторно не спрашиваем.
  useEffect(() => {
    if (!ctx || notifyRequestedRef.current) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "default") return;
    notifyRequestedRef.current = true;
    try {
      void Notification.requestPermission().catch(() => undefined);
    } catch {
      /* no-op: некоторые среды бросают в sandbox */
    }
  }, [ctx]);

  const broadcastEnabled = !!ctx?.viewer.isOwner;

  const submitBroadcast = useCallback(
    async (title: string, body: string): Promise<void> => {
      if (!token) return;
      const res = await fetch("/api/activity/broadcast", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ title, body: body || undefined }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: unknown;
        };
        throw new Error(
          typeof body.error === "string"
            ? body.error
            : `HTTP ${res.status}`,
        );
      }
      // Сам broadcast прилетит через SSE — отдельно не вставляем.
    },
    [token],
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const selectedNode = useMemo(() => {
    if (!ctx || !drawerNodeId) return null;
    return ctx.tree.nodes.find((n) => n.id === drawerNodeId) ?? null;
  }, [ctx, drawerNodeId]);

  if (!token) {
    return (
      <Shell>
        <TokenPrompt
          onSubmit={(next) => {
            window.localStorage.setItem(TOKEN_STORAGE_KEY, next);
            window.localStorage.setItem(LEGACY_WALLET_TOKEN_KEY, next);
            setToken(next);
          }}
        />
      </Shell>
    );
  }

  const logout = () => {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_WALLET_TOKEN_KEY);
    setToken(null);
    setEntries([]);
    setCtx(null);
  };

  return (
    <Shell>
      <HeaderBar
        ctx={ctx}
        ctxError={ctxError}
        liveConnected={liveConnected}
        loading={loading}
        onRefresh={() => {
          void loadInitial();
          void loadCtx();
        }}
        onLogout={logout}
        onBroadcast={
          broadcastEnabled ? () => setBroadcastOpen(true) : undefined
        }
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Center: Activity Feed */}
        <section className="min-w-0">
          {error && (
            <Card className="mb-4 border-destructive/40 bg-destructive/5 text-sm text-destructive">
              {t("common.errorWith", { message: error })}
            </Card>
          )}

          <div className="mb-4 flex flex-wrap items-center gap-2">
            {FILTER_KEYS.map((key) => (
              <FilterButton
                key={key}
                current={filter}
                value={key}
                onClick={setFilter}
              >
                {t(`pulse.filter.${key}`)}
              </FilterButton>
            ))}
          </div>

          {entries.length === 0 && !loading ? (
            <Card className="text-center">
              <CardTitle>{t("pulse.empty.title")}</CardTitle>
              <CardDescription>{t("pulse.empty.body")}</CardDescription>
            </Card>
          ) : (
            <ul className="space-y-3">
              {entries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} />
              ))}
            </ul>
          )}

          <div className="mt-6 flex justify-center">
            {nextBefore ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? t("common.loadingDots") : t("pulse.loadMore")}
              </Button>
            ) : entries.length > 0 ? (
              <p className="text-xs text-foreground/40">
                {t("pulse.noMore")}
              </p>
            ) : null}
          </div>
        </section>

        {/* Sidebar: Vertical tree */}
        <aside className="min-w-0">
          <TreeSidebar
            ctx={ctx}
            activeNodeId={drawerNodeId}
            onNodeOpen={(id) => setDrawerNodeId(id)}
          />
        </aside>
      </div>

      {/* ---- Overlays ---- */}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {broadcastOpen && (
        <BroadcastModal
          onClose={() => setBroadcastOpen(false)}
          onSubmit={submitBroadcast}
        />
      )}

      {selectedNode && ctx && (
        <NodeDetailDrawer
          node={selectedNode}
          ctx={ctx}
          onClose={() => setDrawerNodeId(null)}
        />
      )}
    </Shell>
  );
}

// ------------------------------------------------------------
// Push notifications
// ------------------------------------------------------------

interface ToastItem {
  id: string;
  entry: ActivityEntry;
  createdAt: number;
}

const TOAST_TTL_MS = 10_000;

function isHighPriorityEntry(entry: ActivityEntry): boolean {
  if (entry.event === "core.broadcast.sovereign") return true;
  const md = entry.metadata ?? {};
  if (md.broadcast === true) return true;
  if (md.priority === "high" || md.priority === "urgent") return true;
  return false;
}

/**
 * Вставляет тост и ставит таймер на self-dismiss. Таймер владеет
 * window.setTimeout и очищается автоматически (ownership — у React
 * через setToasts-лямбду; если тост уже ушёл вручную, filter просто
 * не найдёт id и вернёт prev).
 */
function pushToast(
  setToasts: React.Dispatch<React.SetStateAction<ToastItem[]>>,
  entry: ActivityEntry,
): void {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const item: ToastItem = { id, entry, createdAt: Date.now() };
  setToasts((prev) => {
    // Не больше 4 одновременно — чтобы шторка не росла до бесконечности.
    const next = [item, ...prev].slice(0, 4);
    return next;
  });
  window.setTimeout(() => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, TOAST_TTL_MS);
}

function tryWebNotify(entry: ActivityEntry): void {
  if (typeof window === "undefined") return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    const title =
      (entry.metadata?.title as string | undefined) ?? "KrwnOS · Broadcast";
    const body =
      (entry.metadata?.body as string | undefined) ?? "";
    const n = new Notification(title, {
      body,
      tag: entry.id,
      silent: false,
    });
    // Auto-close через 10с (некоторые браузеры держат вечно).
    window.setTimeout(() => n.close(), TOAST_TTL_MS);
  } catch {
    /* no-op: Notification constructor может кидать в sandbox */
  }
}

function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  const { t } = useI18n();
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((item) => {
        const md = item.entry.metadata ?? {};
        const title =
          (md.title as string | undefined) ??
          t("pulse.toast.defaultTitle");
        const body = (md.body as string | undefined) ?? "";
        return (
          <div
            key={item.id}
            className="pointer-events-auto rounded-xl border border-crown/40 bg-background/95 p-4 shadow-2xl shadow-crown/10 backdrop-blur-lg"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-[0.3em] text-crown">
                  {t("pulse.toast.eyebrow")}
                </p>
                <p className="mt-1 truncate text-sm font-semibold text-foreground">
                  {title}
                </p>
                {body && (
                  <p className="mt-1 line-clamp-3 text-xs text-foreground/70">
                    {body}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onDismiss(item.id)}
                aria-label={t("common.close")}
                className="-mr-1 rounded-md p-1 text-foreground/40 hover:bg-foreground/5 hover:text-foreground/80"
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------
// Broadcast modal (Sovereign-only)
// ------------------------------------------------------------

function BroadcastModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (title: string, body: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError(t("pulse.broadcast.errTitleRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(title.trim(), body.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-40 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Card className="w-full max-w-lg border-crown/40 shadow-2xl shadow-crown/10">
        <CardTitle>{t("pulse.broadcast.title")}</CardTitle>
        <CardDescription>{t("pulse.broadcast.subtitle")}</CardDescription>
        <form className="mt-4 flex flex-col gap-3" onSubmit={submit}>
          <label className="flex flex-col gap-1 text-xs">
            <span className="uppercase tracking-widest text-foreground/50">
              {t("pulse.broadcast.headline")}
            </span>
            <Input
              placeholder={t("pulse.broadcast.headlinePh")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              maxLength={200}
              disabled={busy}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="uppercase tracking-widest text-foreground/50">
              {t("pulse.broadcast.body")}
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("pulse.broadcast.bodyPh")}
              rows={5}
              maxLength={2000}
              disabled={busy}
              className="min-h-[110px] rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-crown/60"
            />
            <span className="text-right text-[10px] text-foreground/40">
              {body.length}/2000
            </span>
          </label>

          {error && (
            <p className="rounded-md bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="mt-2 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={busy}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="crown"
              size="sm"
              disabled={busy || !title.trim()}
            >
              {busy
                ? t("common.loadingDots")
                : t("pulse.broadcast.publish")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------
// Node detail drawer (side panel)
// ------------------------------------------------------------

function NodeDetailDrawer({
  node,
  ctx,
  onClose,
}: {
  node: PulseNode;
  ctx: PulseContext;
  onClose: () => void;
}) {
  const { t } = useI18n();

  const children = useMemo(
    () =>
      ctx.tree.nodes
        .filter((n) => n.parentId === node.id)
        .sort((a, b) => a.order - b.order),
    [ctx, node.id],
  );

  const members = useMemo(
    () =>
      ctx.tree.members
        .filter((m) => m.nodeId === node.id)
        .sort((a, b) => {
          if (a.online !== b.online) return a.online ? -1 : 1;
          return (a.displayName ?? a.handle).localeCompare(
            b.displayName ?? b.handle,
          );
        }),
    [ctx, node.id],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-40 flex justify-end bg-background/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="flex h-full w-full max-w-md flex-col border-l border-border/60 bg-background/95 shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-border/40 px-6 py-5">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.3em] text-crown">
              {nodeTypeLabel(node.type, t)}
            </p>
            <h2 className="mt-1 truncate text-xl font-semibold">
              {node.title}
            </h2>
            <p className="mt-1 text-xs text-foreground/50">
              {t("pulse.sidebar.onlineCount", {
                online: node.onlineCount,
                total: node.memberCount,
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded-md p-1.5 text-foreground/50 hover:bg-foreground/5 hover:text-foreground/80"
          >
            ×
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {/* Members */}
          <section>
            <h3 className="mb-2 text-[10px] uppercase tracking-[0.3em] text-foreground/50">
              {t("pulse.drawer.members")}
            </h3>
            {members.length === 0 ? (
              <p className="text-xs text-foreground/40">
                {t("pulse.drawer.membersEmpty")}
              </p>
            ) : (
              <ul className="space-y-2">
                {members.map((m) => (
                  <li
                    key={m.userId}
                    className="flex items-center justify-between rounded-md border border-border/40 bg-background/40 px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={cn(
                          "h-2 w-2 rounded-full",
                          m.online
                            ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]"
                            : "bg-foreground/20",
                        )}
                      />
                      <span className="truncate">
                        {m.displayName || `@${m.handle}`}
                      </span>
                      {m.isSelf && (
                        <span className="rounded border border-crown/40 px-1 text-[9px] uppercase tracking-widest text-crown">
                          {t("pulse.sidebar.you")}
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[10px] text-foreground/30">
                      @{m.handle}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Children */}
          <section>
            <h3 className="mb-2 text-[10px] uppercase tracking-[0.3em] text-foreground/50">
              {t("pulse.drawer.children")}
            </h3>
            {children.length === 0 ? (
              <p className="text-xs text-foreground/40">
                {t("pulse.drawer.childrenEmpty")}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {children.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between rounded-md border border-border/30 bg-background/30 px-3 py-2 text-xs"
                  >
                    <span className="truncate">{c.title}</span>
                    <span className="font-mono text-[10px] text-foreground/40">
                      {c.onlineCount}/{c.memberCount}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Quick actions */}
          <section className="flex flex-wrap gap-2">
            {ctx.viewer.isOwner && (
              <Link href={`/admin/vertical-editor#node-${node.id}`}>
                <Button variant="outline" size="sm">
                  {t("pulse.drawer.edit")}
                </Button>
              </Link>
            )}
            <Link href={`/chat#node-${node.id}`}>
              <Button variant="outline" size="sm">
                {t("pulse.drawer.openChat")}
              </Button>
            </Link>
          </section>
        </div>
      </aside>
    </div>
  );
}

function nodeTypeLabel(
  type: NodeType,
  t: (k: string) => string,
): string {
  switch (type) {
    case "department":
      return t("pulse.nodeType.department");
    case "position":
      return t("pulse.nodeType.position");
    case "rank":
      return t("pulse.nodeType.rank");
    default:
      return "";
  }
}

// ------------------------------------------------------------
// Header
// ------------------------------------------------------------

function HeaderBar({
  ctx,
  ctxError,
  liveConnected,
  loading,
  onRefresh,
  onLogout,
  onBroadcast,
}: {
  ctx: PulseContext | null;
  ctxError: string | null;
  liveConnected: boolean;
  loading: boolean;
  onRefresh: () => void;
  onLogout: () => void;
  /** Undefined → скрываем кнопку (гражданин не может вещать). */
  onBroadcast?: () => void;
}) {
  const { t } = useI18n();
  const viewer = ctx?.viewer;
  const path = ctx?.role.path ?? [];
  const wallet = ctx?.wallet ?? null;

  const roleSummary = useMemo(() => {
    if (!ctx) return null;
    if (viewer?.isOwner) return t("pulse.role.sovereign");
    if (viewer?.isLobbyOnly) return t("pulse.role.lobby");
    if (path.length === 0) return t("pulse.role.none");
    return path[path.length - 1]!.title;
  }, [ctx, viewer, path, t]);

  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.3em] text-crown">
            {t("pulse.eyebrow")}
          </p>
          <h1 className="mt-1 truncate text-3xl font-semibold">
            {ctx?.state.name ?? t("pulse.title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-foreground/60">
            {t("pulse.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge connected={liveConnected} />
          {onBroadcast && (
            <Button variant="crown" size="sm" onClick={onBroadcast}>
              {t("pulse.broadcast.trigger")}
            </Button>
          )}
          {(viewer?.canAuditLog ?? viewer?.isOwner) && (
            <Link href="/admin/audit">
              <Button variant="outline" size="sm">
                {t("pulse.header.audit")}
              </Button>
            </Link>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? t("common.loadingDots") : t("common.refresh")}
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout}>
            {t("common.logout")}
          </Button>
        </div>
      </div>

      {ctxError && (
        <Card className="border-destructive/40 bg-destructive/5 text-sm text-destructive">
          {t("common.errorWith", { message: ctxError })}
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,auto)]">
        <RoleCard ctx={ctx} roleSummary={roleSummary} />
        <BalanceCard wallet={wallet} />
      </div>
    </header>
  );
}

function RoleCard({
  ctx,
  roleSummary,
}: {
  ctx: PulseContext | null;
  roleSummary: string | null;
}) {
  const { t } = useI18n();
  if (!ctx) {
    return (
      <Card className="flex items-center gap-3 py-3 text-sm text-foreground/40">
        {t("common.loading")}
      </Card>
    );
  }
  const { viewer, role } = ctx;
  const displayName = viewer.displayName || viewer.handle;

  return (
    <Card
      className={cn(
        "flex items-center gap-4 py-3",
        viewer.isOwner && "border-crown/50 bg-crown/5",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-sm font-bold",
          viewer.isOwner
            ? "bg-crown text-black"
            : "bg-foreground/10 text-foreground",
        )}
      >
        {displayName.slice(0, 1).toUpperCase()}
      </span>
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">
            {displayName}
          </span>
          <span
            className={cn(
              "rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-widest",
              viewer.isOwner
                ? "border-crown/40 bg-crown/10 text-crown"
                : "border-border/60 text-foreground/60",
            )}
          >
            {roleSummary}
          </span>
        </div>
        {role.path.length > 0 && !viewer.isOwner && (
          <nav
            aria-label={t("pulse.role.pathLabel")}
            className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-foreground/50"
          >
            {role.path.map((seg, i) => (
              <span key={seg.id} className="flex items-center gap-1">
                {i > 0 && <span className="text-foreground/30">›</span>}
                <span
                  className={cn(
                    "truncate",
                    i === role.path.length - 1 && "text-foreground/80",
                  )}
                >
                  {seg.title}
                </span>
              </span>
            ))}
          </nav>
        )}
        {role.path.length === 0 && !viewer.isOwner && (
          <p className="mt-1 text-[11px] text-foreground/40">
            {t("pulse.role.noneHint")}
          </p>
        )}
      </div>
    </Card>
  );
}

function BalanceCard({
  wallet,
}: {
  wallet: PulseContext["wallet"];
}) {
  const { t } = useI18n();
  if (!wallet) {
    return (
      <Card className="flex items-center gap-3 py-3 text-sm text-foreground/40">
        <span className="flex h-10 w-10 items-center justify-center rounded-md bg-foreground/5 text-lg">
          {KRONA_SYMBOL}
        </span>
        <div className="flex flex-col leading-tight">
          <span className="text-[10px] uppercase tracking-widest text-foreground/40">
            {t("pulse.balance.label")}
          </span>
          <span className="text-sm text-foreground/50">
            {t("pulse.balance.none")}
          </span>
        </div>
      </Card>
    );
  }
  return (
    <Card className="flex items-center gap-3 py-3">
      <span
        aria-hidden
        className="flex h-10 w-10 items-center justify-center rounded-md bg-crown text-lg font-bold text-black"
      >
        {KRONA_SYMBOL}
      </span>
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="text-[10px] uppercase tracking-widest text-foreground/50">
          {t("pulse.balance.label")}
        </span>
        <span className="font-mono text-base font-semibold tabular-nums text-foreground">
          {formatAmount(wallet.balance, { currency: wallet.currency })}
        </span>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------
// Sidebar (Vertical tree + online presence)
// ------------------------------------------------------------

function TreeSidebar({
  ctx,
  activeNodeId,
  onNodeOpen,
}: {
  ctx: PulseContext | null;
  activeNodeId: string | null;
  onNodeOpen: (nodeId: string) => void;
}) {
  const { t } = useI18n();

  if (!ctx) {
    return (
      <Card className="text-sm text-foreground/40">{t("common.loading")}</Card>
    );
  }

  const { nodes, members } = ctx.tree;
  if (nodes.length === 0) {
    return (
      <Card>
        <CardTitle>{t("pulse.sidebar.title")}</CardTitle>
        <CardDescription>{t("pulse.sidebar.emptyTree")}</CardDescription>
      </Card>
    );
  }

  const roots = nodes.filter((n) => !n.parentId);
  const childrenOf = new Map<string | null, PulseNode[]>();
  for (const n of nodes) {
    const bucket = childrenOf.get(n.parentId) ?? [];
    bucket.push(n);
    childrenOf.set(n.parentId, bucket);
  }
  for (const bucket of childrenOf.values()) {
    bucket.sort((a, b) => a.order - b.order);
  }

  const membersByNode = new Map<string, PulseMember[]>();
  for (const m of members) {
    const bucket = membersByNode.get(m.nodeId) ?? [];
    bucket.push(m);
    membersByNode.set(m.nodeId, bucket);
  }

  const onlineTotal = ctx.tree.onlineUserIds.length;

  return (
    <div className="flex flex-col gap-3">
      <Card className="py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-foreground/50">
              {t("pulse.sidebar.title")}
            </p>
            <p className="mt-0.5 text-sm text-foreground">
              {t("pulse.sidebar.onlineTotal", { count: onlineTotal })}
            </p>
          </div>
          <span
            className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse"
            aria-hidden
          />
        </div>
      </Card>

      <Card className="py-3">
        <ul className="space-y-1">
          {roots.map((n) => (
            <TreeNodeRow
              key={n.id}
              node={n}
              depth={0}
              childrenOf={childrenOf}
              membersByNode={membersByNode}
              viewerId={ctx.viewer.userId}
              primaryNodeId={ctx.role.primaryNodeId}
              activeNodeId={activeNodeId}
              onNodeOpen={onNodeOpen}
            />
          ))}
        </ul>
      </Card>

      <p className="text-[10px] text-foreground/40">
        {t("pulse.sidebar.footnote", {
          seconds: Math.round(ctx.presenceWindowMs / 1000),
        })}
      </p>
    </div>
  );
}

function TreeNodeRow({
  node,
  depth,
  childrenOf,
  membersByNode,
  viewerId,
  primaryNodeId,
  activeNodeId,
  onNodeOpen,
}: {
  node: PulseNode;
  depth: number;
  childrenOf: Map<string | null, PulseNode[]>;
  membersByNode: Map<string, PulseMember[]>;
  viewerId: string;
  primaryNodeId: string | null;
  activeNodeId: string | null;
  onNodeOpen: (nodeId: string) => void;
}) {
  // Узлы с участниками стартуют раскрытыми; пустые ветки схлопнуты.
  const kids = childrenOf.get(node.id) ?? [];
  const members = membersByNode.get(node.id) ?? [];
  const initiallyOpen =
    members.length > 0 || kids.length > 0 || node.id === primaryNodeId;
  const [open, setOpen] = useState(initiallyOpen);

  const isSelfHere = members.some((m) => m.userId === viewerId);
  const isActive = node.id === activeNodeId;

  return (
    <li>
      {/**
       * Строка узла теперь — "composite button": слева chevron (он же
       * toggle), справа — сам title, по которому открывается drawer.
       * Разделение кликов через вложенные <button> вне <button> —
       * поэтому используем два отдельных элемента в одном flex-ряду.
       */}
      <div
        className={cn(
          "group flex w-full items-center gap-1 rounded-md pr-2 text-left text-sm transition-colors",
          isSelfHere && "bg-crown/5",
          isActive && "bg-crown/10 ring-1 ring-crown/40",
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "collapse" : "expand"}
          className={cn(
            "flex h-7 w-4 shrink-0 items-center justify-center text-foreground/40 hover:text-foreground",
            kids.length === 0 && "invisible",
          )}
        >
          {open ? "▾" : "▸"}
        </button>
        <button
          type="button"
          onClick={() => onNodeOpen(node.id)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left hover:bg-foreground/5",
            isActive && "hover:bg-crown/10",
          )}
        >
          <span
            className={cn(
              "truncate",
              isSelfHere ? "text-crown" : "text-foreground/90",
              isActive && "font-medium",
            )}
          >
            {node.title}
          </span>
          {node.isLobby && (
            <span className="rounded-sm border border-border/50 px-1 text-[9px] uppercase tracking-wider text-foreground/50">
              lobby
            </span>
          )}
          <span className="ml-auto flex items-center gap-2 text-[11px] text-foreground/50">
            {node.onlineCount > 0 && (
              <span className="flex items-center gap-1">
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                />
                {node.onlineCount}
              </span>
            )}
            <span className="font-mono">{node.memberCount}</span>
          </span>
        </button>
      </div>

      {open && members.length > 0 && (
        <ul className="mt-0.5 space-y-0.5">
          {members.map((m) => (
            <MemberRow key={m.userId + m.nodeId} member={m} depth={depth + 1} />
          ))}
        </ul>
      )}
      {open && kids.length > 0 && (
        <ul className="mt-0.5 space-y-0.5">
          {kids.map((kid) => (
            <TreeNodeRow
              key={kid.id}
              node={kid}
              depth={depth + 1}
              childrenOf={childrenOf}
              membersByNode={membersByNode}
              viewerId={viewerId}
              primaryNodeId={primaryNodeId}
              activeNodeId={activeNodeId}
              onNodeOpen={onNodeOpen}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function MemberRow({
  member,
  depth,
}: {
  member: PulseMember;
  depth: number;
}) {
  const displayName = member.displayName || `@${member.handle}`;
  return (
    <li
      className={cn(
        "flex items-center gap-2 px-2 py-0.5 text-[12px]",
        member.isSelf && "text-crown",
      )}
      style={{ paddingLeft: `${8 + depth * 14}px` }}
    >
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          member.online ? "bg-emerald-500" : "bg-foreground/20",
        )}
        title={member.online ? "online" : "offline"}
      />
      <span
        className={cn(
          "truncate",
          !member.online && !member.isSelf && "text-foreground/40",
        )}
      >
        {displayName}
      </span>
      {member.isSelf && (
        <span className="rounded-sm border border-crown/40 bg-crown/5 px-1 text-[9px] uppercase tracking-wider text-crown">
          you
        </span>
      )}
    </li>
  );
}

// ------------------------------------------------------------
// Activity feed row (unchanged from previous revision)
// ------------------------------------------------------------

function EntryRow({ entry }: { entry: ActivityEntry }) {
  const { t, formatDateTime } = useI18n();
  const title = renderTitle(entry, t);
  const href = deriveHref(entry);
  const tint = categoryTint(entry.category);

  const body = (
    <Card className="transition-colors hover:border-crown/40">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-1 rounded-md border px-2 py-1 text-[10px] uppercase tracking-widest",
            tint,
          )}
        >
          {categoryLabel(entry.category, t)}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground/90">{title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground/50">
            <span>{formatDateTime(entry.createdAt)}</span>
            {entry.actorId && (
              <span className="font-mono">
                {entry.actorId.slice(0, 10)}…
              </span>
            )}
            {entry.nodeId && (
              <span className="rounded-sm border border-border/50 px-1 py-0.5 font-mono text-[10px]">
                node:{entry.nodeId.slice(0, 6)}…
              </span>
            )}
            <span className="text-foreground/30">{entry.event}</span>
          </div>
        </div>
      </div>
    </Card>
  );
  return <li>{href ? <Link href={href}>{body}</Link> : body}</li>;
}

function renderTitle(
  entry: ActivityEntry,
  t: (k: string, vars?: Record<string, string | number>) => string,
): string {
  const params = normaliseParams(entry.titleParams);
  return t(entry.titleKey, params);
}

function normaliseParams(
  raw: Record<string, unknown>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (typeof v === "number" || typeof v === "string") {
      out[k] = v;
    } else if (v == null) {
      out[k] = "";
    } else {
      try {
        out[k] = JSON.stringify(v);
      } catch {
        out[k] = String(v);
      }
    }
  }
  return out;
}

function deriveHref(entry: ActivityEntry): string | null {
  switch (entry.category) {
    case "governance":
      return "/governance";
    case "state":
      return "/admin/constitution";
    case "wallet":
    case "chat":
    default:
      return null;
  }
}

function categoryTint(cat: ActivityCategory): string {
  switch (cat) {
    case "wallet":
      return "border-emerald-500/40 bg-emerald-500/5 text-emerald-500";
    case "chat":
      return "border-sky-500/40 bg-sky-500/5 text-sky-400";
    case "governance":
      return "border-crown/40 bg-crown/5 text-crown";
    case "state":
      return "border-purple-500/40 bg-purple-500/5 text-purple-400";
    case "kernel":
      return "border-border/50 bg-background/50 text-foreground/70";
    default:
      return "border-border/50 bg-background/50 text-foreground/70";
  }
}

function categoryLabel(
  cat: ActivityCategory,
  t: (k: string) => string,
): string {
  switch (cat) {
    case "wallet":
      return t("pulse.filter.wallet");
    case "chat":
      return t("pulse.filter.chat");
    case "governance":
      return t("pulse.filter.governance");
    case "state":
      return t("pulse.filter.state");
    case "kernel":
      return t("pulse.filter.kernel");
    default:
      return cat;
  }
}

function FilterButton({
  current,
  value,
  onClick,
  children,
}: {
  current: FilterKey;
  value: FilterKey;
  onClick: (next: FilterKey) => void;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={cn(
        "rounded-md border px-3 py-1 text-xs uppercase tracking-wider transition-colors",
        active
          ? "border-crown/60 bg-crown/10 text-crown"
          : "border-border/60 text-foreground/60 hover:bg-background/60",
      )}
    >
      {children}
    </button>
  );
}

function LiveBadge({ connected }: { connected: boolean }) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] uppercase tracking-widest",
        connected
          ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-500"
          : "border-border/60 bg-background/60 text-foreground/50",
      )}
      aria-live="polite"
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          connected ? "bg-emerald-500 animate-pulse" : "bg-foreground/30",
        )}
      />
      {connected ? t("pulse.live.connected") : t("pulse.live.offline")}
    </span>
  );
}

function TokenPrompt({ onSubmit }: { onSubmit: (token: string) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  return (
    <Card className="mx-auto mt-24 max-w-md">
      <CardTitle>{t("pulse.token.title")}</CardTitle>
      <CardDescription>
        {t("pulse.token.desc", { cmd: "krwn token mint" })}
      </CardDescription>
      <form
        className="mt-4 flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <Input
          placeholder="kt_…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        <Button type="submit" variant="crown">
          {t("common.login")}
        </Button>
      </form>
    </Card>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-6 py-8">
      {children}
    </main>
  );
}
