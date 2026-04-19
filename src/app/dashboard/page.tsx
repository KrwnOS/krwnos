/**
 * `/dashboard` — Пульс Государства (State Pulse).
 * ------------------------------------------------------------
 * Главный экран гражданина. Агрегированная лента событий всех
 * модулей (Wallet / Chat / Governance / State / Kernel) с живым
 * обновлением через SSE (`/api/activity/stream`) и фильтрацией
 * «только то, что касается меня или моего узла».
 *
 * Как работает фильтрация:
 *   1. Страница держит CLI-токен в localStorage (та же схема, что
 *      и у `/governance`).
 *   2. Сервер в `/api/activity` собирает `scopeNodeIds` — множество
 *      узлов пользователя плюс их предков по Вертикали — и отдаёт
 *      только те строки, visibility которых совпала с правилом.
 *   3. SSE-поток дополнительно прокидывает ту же проверку на каждое
 *      новое событие.
 *
 * Вся копирайтинговая часть живёт под ключами `pulse.*` в
 * locales, а UI-ные названия событий — под `pulse.event.*`.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

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

const TOKEN_STORAGE_KEY = "krwn.token";
const FILTER_KEYS = [
  "all",
  "wallet",
  "chat",
  "governance",
  "state",
  "kernel",
] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

export default function DashboardPage() {
  const { t } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [viewer, setViewer] = useState<FeedPage["viewer"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [liveConnected, setLiveConnected] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setToken(window.localStorage.getItem(TOKEN_STORAGE_KEY));
  }, []);

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
      setViewer(body.viewer);
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

  // --- SSE live feed ---
  const esRef = useRef<EventSource | null>(null);
  useEffect(() => {
    if (!token) return;
    // Native EventSource doesn't allow custom headers, so we pass the
    // token through `?token=` (see `authenticateCli`).
    const es = new EventSource(
      `/api/activity/stream?token=${encodeURIComponent(token)}`,
    );
    esRef.current = es;

    const onReady = () => setLiveConnected(true);
    const onActivity = (ev: MessageEvent<string>) => {
      try {
        const entry = JSON.parse(ev.data) as ActivityEntry;
        setEntries((prev) => {
          if (prev.some((e) => e.id === entry.id)) return prev;
          if (filter !== "all" && entry.category !== filter) return prev;
          return [entry, ...prev];
        });
      } catch {
        /* ignore malformed frame */
      }
    };
    const onError = () => setLiveConnected(false);

    es.addEventListener("ready", onReady);
    es.addEventListener("activity", onActivity as EventListener);
    es.onerror = onError;

    return () => {
      es.removeEventListener("ready", onReady);
      es.removeEventListener("activity", onActivity as EventListener);
      es.close();
      esRef.current = null;
      setLiveConnected(false);
    };
  }, [token, filter]);

  if (!token) {
    return (
      <Shell>
        <TokenPrompt
          onSubmit={(next) => {
            window.localStorage.setItem(TOKEN_STORAGE_KEY, next);
            setToken(next);
          }}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-crown">
            {t("pulse.eyebrow")}
          </p>
          <h1 className="mt-1 text-3xl font-semibold">{t("pulse.title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-foreground/60">
            {t("pulse.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {viewer && (
            <span
              className={cn(
                "rounded-md border px-2 py-1 text-[10px] uppercase tracking-widest",
                viewer.isOwner
                  ? "border-crown/40 bg-crown/10 text-crown"
                  : "border-border/60 text-foreground/60",
              )}
            >
              {viewer.isOwner
                ? t("pulse.viewer.sovereign")
                : t("pulse.viewer.citizen")}
            </span>
          )}
          <LiveBadge connected={liveConnected} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadInitial()}
            disabled={loading}
          >
            {loading ? t("common.loadingDots") : t("common.refresh")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              window.localStorage.removeItem(TOKEN_STORAGE_KEY);
              setToken(null);
              setEntries([]);
              setViewer(null);
            }}
          >
            {t("common.logout")}
          </Button>
        </div>
      </header>

      {error && (
        <Card className="mb-6 border-destructive/40 bg-destructive/5 text-sm text-destructive">
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
          <p className="text-xs text-foreground/40">{t("pulse.noMore")}</p>
        ) : null}
      </div>
    </Shell>
  );
}

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

// UI-only routing hint: links clickable events back to their owning
// module page. The feed itself doesn't prescribe where to go; this
// keeps every event discoverable without a dedicated server-side
// field.
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
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12">
      {children}
    </main>
  );
}
