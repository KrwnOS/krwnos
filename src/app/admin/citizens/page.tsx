/**
 * `/admin/citizens` — unified citizen administration for the Sovereign
 * and delegated holders of `members.*` / `invitations.create`.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";

const TOKEN_STORAGE_KEY = "krwn.token";
const CITIZEN_FEED_PATH = "/";

interface VerticalNodeDto {
  id: string;
  title: string;
  isLobby: boolean;
}

interface CitizenRow {
  userId: string;
  handle: string;
  displayName: string | null;
  nodeId: string;
  nodeTitle: string;
  isLobby: boolean;
  title: string | null;
  status: "active" | "pending";
  banned: boolean;
}

export default function AdminCitizensPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [nodes, setNodes] = useState<VerticalNodeDto[]>([]);
  const [rows, setRows] = useState<CitizenRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [nodeFilter, setNodeFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "pending">(
    "all",
  );
  const [q, setQ] = useState("");

  const [mergeSource, setMergeSource] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setToken(window.localStorage.getItem(TOKEN_STORAGE_KEY));
  }, []);

  const loadNodes = useCallback(async () => {
    if (!token) return;
    const res = await fetch("/api/admin/vertical", {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.status === 403) {
      router.replace(CITIZEN_FEED_PATH);
      return;
    }
    const payload = (await res.json()) as
      | { nodes: VerticalNodeDto[] }
      | { error: string };
    if (!res.ok) {
      throw new Error("error" in payload ? String(payload.error) : `HTTP ${res.status}`);
    }
    setNodes(
      (payload as { nodes: VerticalNodeDto[] }).nodes.map((n) => ({
        id: n.id,
        title: n.title,
        isLobby: n.isLobby,
      })),
    );
  }, [token, router]);

  const loadRows = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (nodeFilter) params.set("nodeId", nodeFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (q.trim()) params.set("q", q.trim());
      params.set("limit", "120");
      const res = await fetch(`/api/admin/citizens?${params.toString()}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (res.status === 403) {
        router.replace(CITIZEN_FEED_PATH);
        return;
      }
      const payload = (await res.json()) as
        | { rows: CitizenRow[] }
        | { error: string };
      if (!res.ok) {
        throw new Error("error" in payload ? String(payload.error) : `HTTP ${res.status}`);
      }
      setRows((payload as { rows: CitizenRow[] }).rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("citizens.admin.err"));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [token, router, nodeFilter, statusFilter, q, t]);

  useEffect(() => {
    if (!token) return;
    void loadNodes();
  }, [token, loadNodes]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const authHeaders = useMemo(
    () =>
      token
        ? {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          }
        : null,
    [token],
  );

  const postAction = useCallback(
    async (body: Record<string, unknown>) => {
      if (!authHeaders) return;
      setFlash(null);
      const res = await fetch("/api/admin/citizens", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(body),
      });
      const payload = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok) {
        setError(payload.error ?? t("citizens.admin.err"));
        return;
      }
      setFlash("ok");
      await loadRows();
    },
    [authHeaders, loadRows, t],
  );

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
            {t("citizens.admin.eyebrow")}
          </p>
          <h1 className="mt-1 text-3xl font-semibold">{t("citizens.admin.title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-foreground/60">
            {t("citizens.admin.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void loadNodes();
              void loadRows();
            }}
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
              setRows([]);
              setNodes([]);
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
      {flash && (
        <Card className="mb-6 border-crown/40 bg-crown/5 text-sm text-crown">
          {t("common.confirm")}
        </Card>
      )}

      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-widest text-foreground/60">
            {t("citizens.admin.filter.node")}
            <select
              className="mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={nodeFilter}
              onChange={(e) => setNodeFilter(e.target.value)}
            >
              <option value="">{t("citizens.admin.filter.nodeAll")}</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                  {n.isLobby ? " (lobby)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-widest text-foreground/60">
            {t("citizens.admin.filter.status")}
            <select
              className="mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as "all" | "active" | "pending")
              }
            >
              <option value="all">{t("citizens.admin.filter.statusAll")}</option>
              <option value="active">{t("citizens.admin.filter.statusActive")}</option>
              <option value="pending">{t("citizens.admin.filter.statusPending")}</option>
            </select>
          </label>
          <label className="min-w-[200px] flex flex-1 flex-col gap-1 text-xs font-semibold uppercase tracking-widest text-foreground/60">
            {t("citizens.admin.search")}
            <Input
              className="mt-1"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="@handle"
            />
          </label>
          <Button type="button" variant="secondary" size="sm" onClick={() => void loadRows()}>
            {t("common.refresh")}
          </Button>
        </div>
      </Card>

      <Card>
        <CardTitle className="text-base">{t("citizens.admin.title")}</CardTitle>
        <CardDescription className="mt-1">
          {loading ? t("common.loading") : `${rows.length} rows`}
        </CardDescription>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-widest text-foreground/50">
                <th className="py-2 pr-3">{t("citizens.admin.col.user")}</th>
                <th className="py-2 pr-3">{t("citizens.admin.col.node")}</th>
                <th className="py-2 pr-3">{t("citizens.admin.col.title")}</th>
                <th className="py-2 pr-3">{t("citizens.admin.col.status")}</th>
                <th className="py-2 pr-3">{t("citizens.admin.col.banned")}</th>
                <th className="py-2">{t("common.details")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="py-8 text-foreground/50">
                    {t("citizens.admin.empty")}
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={`${r.userId}-${r.nodeId}`} className="border-b border-border/60">
                  <td className="py-2 pr-3 font-mono text-xs">
                    <div>{r.handle}</div>
                    <div className="text-foreground/50">{r.userId}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <div>{r.nodeTitle}</div>
                    <div className="text-foreground/50">{r.nodeId}</div>
                  </td>
                  <td className="py-2 pr-3">{r.title ?? t("common.notSet")}</td>
                  <td className="py-2 pr-3">{r.status}</td>
                  <td className="py-2 pr-3">{r.banned ? t("common.yes") : t("common.no")}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (!confirm("Kick?")) return;
                          void postAction({
                            action: "kick",
                            userId: r.userId,
                            nodeId: r.nodeId,
                          });
                        }}
                      >
                        {t("citizens.admin.action.kick")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          const reason = window.prompt(t("citizens.admin.prompt.banReason"));
                          if (reason === null) return;
                          void postAction({
                            action: "ban",
                            userId: r.userId,
                            reason: reason || null,
                          });
                        }}
                      >
                        {t("citizens.admin.action.ban")}
                      </Button>
                      {r.banned && (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            void postAction({ action: "unban", userId: r.userId })
                          }
                        >
                          {t("citizens.admin.action.unban")}
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          const toNodeId = window.prompt(t("citizens.admin.prompt.moveTo"));
                          if (!toNodeId?.trim()) return;
                          void postAction({
                            action: "move",
                            userId: r.userId,
                            fromNodeId: r.nodeId,
                            toNodeId: toNodeId.trim(),
                          });
                        }}
                      >
                        {t("citizens.admin.action.move")}
                      </Button>
                      {r.status === "pending" && r.isLobby && (
                        <Button
                          type="button"
                          size="sm"
                          variant="crown"
                          onClick={() => {
                            const targetNodeId = window.prompt(
                              "Admit to node id (non-lobby)",
                            );
                            if (!targetNodeId?.trim()) return;
                            void postAction({
                              action: "admit",
                              userId: r.userId,
                              targetNodeId: targetNodeId.trim(),
                            });
                          }}
                        >
                          {t("citizens.admin.action.admit")}
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const title = window.prompt(t("citizens.admin.prompt.title"));
                          if (title === null) return;
                          void postAction({
                            action: "editTitle",
                            userId: r.userId,
                            nodeId: r.nodeId,
                            title: title.length ? title : null,
                          });
                        }}
                      >
                        {t("citizens.admin.action.title")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-8">
        <CardTitle className="text-base">{t("citizens.admin.merge.title")}</CardTitle>
        <CardDescription>{t("citizens.admin.merge.hint")}</CardDescription>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-widest text-foreground/60">
            {t("citizens.admin.merge.source")}
            <Input value={mergeSource} onChange={(e) => setMergeSource(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-widest text-foreground/60">
            {t("citizens.admin.merge.target")}
            <Input value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} />
          </label>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              if (!mergeSource.trim() || !mergeTarget.trim()) return;
              if (
                !confirm(
                  "Irreversible merge: source account will be deleted. Continue?",
                )
              ) {
                return;
              }
              void postAction({
                action: "merge",
                sourceUserId: mergeSource.trim(),
                targetUserId: mergeTarget.trim(),
              });
            }}
          >
            {t("citizens.admin.merge.run")}
          </Button>
        </div>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12">{children}</main>
  );
}

function TokenPrompt({ onSubmit }: { onSubmit: (token: string) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  return (
    <Card className="mx-auto mt-24 max-w-md">
      <CardTitle>{t("citizens.admin.token.title")}</CardTitle>
      <CardDescription>
        {t("citizens.admin.token.desc", { cmd: "krwn token mint" })}
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
