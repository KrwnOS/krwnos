/**
 * `/admin/audit` — Audit Log (Журнал аудита).
 * ------------------------------------------------------------
 * Полный хвост `ActivityLog` для государства — расширенный вид
 * «Пульса» без visibility-фильтра (Суверен видит всё, включая
 * строки с `visibility: sovereign` и `audience`). Используется
 * для разбора инцидентов: «кто когда и с каким намерением
 * поменял налог», «какие указы огласил Суверен», «сколько
 * транзакций провёл Минфин за неделю».
 *
 * Доступ: только Суверен или держатель `system.admin`. Остальным
 * страница отвечает 403 и редиректит на «/». Guard реализован на
 * клиенте (token + первый ответ /api/state/pulse); сервер тоже
 * проверяет scope в каждом подзапросе (`/api/activity`
 * использует `isVisibleTo`, а Суверен всегда проходит).
 *
 * Данные:
 *   * `GET /api/activity?limit=100&category=...&event=...&actorId=...&before=...`
 *     — Сервис уже поддерживает все эти фильтры (см. патч
 *     `ActivityRepository`).
 *   * `GET /api/state/pulse` — тянем только ради списка
 *     граждан: чтобы показывать handle/displayName вместо cuid.
 *
 * UX:
 *   * Row = компактная строка: `timestamp · category · event ·
 *     actor · title · visibility`.
 *   * Поля фильтров сверху — live: меняешь значение, подгружается
 *     страница заново с начала.
 *   * «Экспорт JSON» / «Экспорт CSV» выгружают текущую пачку,
 *     чтобы Суверен мог передать следователю файл.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

// ------------------------------------------------------------
// Wire types
// ------------------------------------------------------------

interface AuditEntry {
  id: string;
  stateId: string;
  event: string;
  category: string;
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
  entries: AuditEntry[];
  nextBefore: string | null;
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
  };
  state: { id: string; slug: string; name: string };
  tree: { members: PulseMember[] };
}

const TOKEN_STORAGE_KEY = "krwn.token";
const LEGACY_WALLET_TOKEN_KEY = "krwn.cli_token";

const CATEGORY_OPTIONS = [
  "all",
  "wallet",
  "chat",
  "governance",
  "state",
  "kernel",
  "exchange",
] as const;
type CategoryFilter = (typeof CATEGORY_OPTIONS)[number];

export default function AuditPage() {
  const { t, formatDateTime } = useI18n();
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);

  // Pulse-ctx (used for sovereign gate + actor handle lookup)
  const [ctx, setCtx] = useState<PulseContext | null>(null);
  const [ctxError, setCtxError] = useState<string | null>(null);

  // Audit feed
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [eventName, setEventName] = useState("");
  const [actorQuery, setActorQuery] = useState("");

  // Debounce filters so typing doesn't hammer the API.
  const debounceRef = useRef<number | null>(null);

  // Bootstrap token from localStorage.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const primary = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    const legacy = window.localStorage.getItem(LEGACY_WALLET_TOKEN_KEY);
    setToken(primary ?? legacy);
  }, []);

  // Resolve actorQuery → actorId через member handle/name map.
  const actorIndex = useMemo(() => {
    const byHandle = new Map<string, PulseMember>();
    const byId = new Map<string, PulseMember>();
    if (!ctx) return { byHandle, byId };
    for (const m of ctx.tree.members) {
      byHandle.set(m.handle.toLowerCase(), m);
      byId.set(m.userId, m);
    }
    return { byHandle, byId };
  }, [ctx]);

  const resolvedActorId = useMemo(() => {
    const q = actorQuery.trim().toLowerCase();
    if (!q) return null;
    // "@handle" или "handle" → lookup по handle
    const key = q.startsWith("@") ? q.slice(1) : q;
    const byHandle = actorIndex.byHandle.get(key);
    if (byHandle) return byHandle.userId;
    // Иначе считаем, что это cuid (полный или префикс).
    for (const m of actorIndex.byId.values()) {
      if (m.userId === q) return m.userId;
    }
    return q.length >= 6 ? q : null;
  }, [actorQuery, actorIndex]);

  // --- Pulse ctx ---
  const loadCtx = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/state/pulse", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const body = (await res.json()) as PulseContext | { error: unknown };
      if (res.status === 401 || res.status === 403) {
        setCtxError("forbidden");
        return;
      }
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
  }, [loadCtx]);

  // Gate: non-sovereign users → redirect.
  useEffect(() => {
    if (!ctx) return;
    if (!ctx.viewer.isOwner) {
      router.replace("/");
    }
  }, [ctx, router]);

  // --- Audit feed ---
  const fetchPage = useCallback(
    async (before: string | null) => {
      if (!token) return null;
      const qs = new URLSearchParams();
      qs.set("limit", "100");
      if (category !== "all") qs.set("category", category);
      if (eventName.trim()) qs.set("event", eventName.trim());
      if (resolvedActorId) qs.set("actorId", resolvedActorId);
      if (before) qs.set("before", before);
      const res = await fetch(`/api/activity?${qs.toString()}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
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
      return body;
    },
    [token, category, eventName, resolvedActorId],
  );

  const reload = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const body = await fetchPage(null);
      if (!body) return;
      setEntries(body.entries);
      setNextBefore(body.nextBefore);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setLoading(false);
    }
  }, [token, fetchPage]);

  // Debounced reload when filters change.
  useEffect(() => {
    if (!token) return;
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      void reload();
    }, 250);
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [reload, token]);

  const loadMore = useCallback(async () => {
    if (!token || !nextBefore) return;
    setLoadingMore(true);
    try {
      const body = await fetchPage(nextBefore);
      if (!body) return;
      setEntries((prev) => [...prev, ...body.entries]);
      setNextBefore(body.nextBefore);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setLoadingMore(false);
    }
  }, [token, nextBefore, fetchPage]);

  // --- Exports ---
  const exportJSON = useCallback(() => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], {
      type: "application/json",
    });
    triggerDownload(blob, `audit-${Date.now()}.json`);
  }, [entries]);

  const exportCSV = useCallback(() => {
    const head = [
      "createdAt",
      "category",
      "event",
      "actorId",
      "actorHandle",
      "nodeId",
      "visibility",
      "titleKey",
    ];
    const rows = entries.map((e) => {
      const actor = e.actorId ? actorIndex.byId.get(e.actorId) : null;
      return [
        e.createdAt,
        e.category,
        e.event,
        e.actorId ?? "",
        actor?.handle ?? "",
        e.nodeId ?? "",
        e.visibility,
        e.titleKey,
      ];
    });
    const csv = [head, ...rows]
      .map((r) => r.map(csvCell).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    triggerDownload(blob, `audit-${Date.now()}.csv`);
  }, [entries, actorIndex]);

  // --- Render ---
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

  if (ctxError === "forbidden") {
    return (
      <Shell>
        <Card className="mx-auto mt-24 max-w-md">
          <CardTitle>{t("audit.forbidden.title")}</CardTitle>
          <CardDescription>{t("audit.forbidden.body")}</CardDescription>
          <div className="mt-4">
            <Link href="/dashboard">
              <Button variant="outline" size="sm">
                {t("audit.forbidden.back")}
              </Button>
            </Link>
          </div>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-crown">
            {t("audit.eyebrow")}
          </p>
          <h1 className="mt-1 text-3xl font-semibold">{t("audit.title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-foreground/60">
            {t("audit.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void reload()}>
            {loading ? t("common.loadingDots") : t("common.refresh")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={entries.length === 0}
            onClick={exportJSON}
          >
            JSON
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={entries.length === 0}
            onClick={exportCSV}
          >
            CSV
          </Button>
          <Link href="/dashboard">
            <Button variant="ghost" size="sm">
              {t("audit.backToPulse")}
            </Button>
          </Link>
        </div>
      </header>

      {/* Filters */}
      <Card className="mb-4 py-4">
        <div className="grid gap-3 md:grid-cols-[minmax(120px,auto)_minmax(0,1fr)_minmax(0,1fr)]">
          <label className="flex flex-col gap-1 text-xs">
            <span className="uppercase tracking-widest text-foreground/50">
              {t("audit.filter.category")}
            </span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as CategoryFilter)}
              className="h-9 rounded-md border border-border/60 bg-background/60 px-2 text-sm"
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c === "all" ? t("pulse.filter.all") : c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="uppercase tracking-widest text-foreground/50">
              {t("audit.filter.event")}
            </span>
            <Input
              placeholder="core.wallet.transaction.created"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="uppercase tracking-widest text-foreground/50">
              {t("audit.filter.actor")}
            </span>
            <Input
              placeholder={t("audit.filter.actorPlaceholder")}
              value={actorQuery}
              onChange={(e) => setActorQuery(e.target.value)}
            />
          </label>
        </div>
      </Card>

      {error && (
        <Card className="mb-4 border-destructive/40 bg-destructive/5 text-sm text-destructive">
          {t("common.errorWith", { message: error })}
        </Card>
      )}

      {entries.length === 0 && !loading ? (
        <Card className="text-center">
          <CardTitle>{t("audit.empty.title")}</CardTitle>
          <CardDescription>{t("audit.empty.body")}</CardDescription>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-background/40 backdrop-blur-sm">
          <table className="w-full text-left text-xs">
            <thead className="bg-foreground/5 text-[10px] uppercase tracking-widest text-foreground/50">
              <tr>
                <th className="px-3 py-2 font-medium">{t("audit.col.when")}</th>
                <th className="px-3 py-2 font-medium">
                  {t("audit.col.category")}
                </th>
                <th className="px-3 py-2 font-medium">{t("audit.col.event")}</th>
                <th className="px-3 py-2 font-medium">{t("audit.col.actor")}</th>
                <th className="px-3 py-2 font-medium">{t("audit.col.title")}</th>
                <th className="px-3 py-2 font-medium">
                  {t("audit.col.visibility")}
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const actor = e.actorId ? actorIndex.byId.get(e.actorId) : null;
                const title = safeTitle(e, t);
                return (
                  <tr
                    key={e.id}
                    className="border-t border-border/40 align-top hover:bg-foreground/[0.02]"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-foreground/70">
                      {formatDateTime(e.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-widest",
                          categoryTint(e.category),
                        )}
                      >
                        {e.category}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-foreground/70">
                      {e.event}
                    </td>
                    <td className="px-3 py-2 text-foreground/80">
                      {actor ? (
                        <span>
                          {actor.displayName || `@${actor.handle}`}
                          <span className="ml-1 font-mono text-[10px] text-foreground/40">
                            {actor.userId.slice(0, 6)}…
                          </span>
                        </span>
                      ) : e.actorId ? (
                        <span className="font-mono text-[10px] text-foreground/50">
                          {e.actorId.slice(0, 10)}…
                        </span>
                      ) : (
                        <span className="text-foreground/30">{t("audit.actor.system")}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-foreground/90">{title}</td>
                    <td className="px-3 py-2 text-[10px] uppercase tracking-widest text-foreground/50">
                      {e.visibility}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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

      <p className="mt-6 text-center text-[10px] text-foreground/40">
        {t("audit.footnote")}
      </p>
    </Shell>
  );
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function safeTitle(
  entry: AuditEntry,
  t: (k: string, vars?: Record<string, string | number>) => string,
): string {
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(entry.titleParams ?? {})) {
    if (typeof v === "number" || typeof v === "string") params[k] = v;
    else if (v == null) params[k] = "";
    else params[k] = JSON.stringify(v);
  }
  const rendered = t(entry.titleKey, params);
  // Если ключа нет в dictionary (напр. неизвестное событие), рендерер
  // может вернуть сам ключ; в таком случае показываем event без
  // декорации — всё равно он уже в соседней колонке.
  return rendered === entry.titleKey ? "—" : rendered;
}

function categoryTint(cat: string): string {
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

function csvCell(value: string): string {
  const s = value ?? "";
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
