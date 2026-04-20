"use client";

import { useMemo } from "react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { formatAmount } from "@/components/wallet/format";
import { useI18n } from "@/lib/i18n";
import {
  aggregateStateTaxByDay,
  aggregateWalletVolumeByDay,
  extractVoteParticipation,
  type NamedSeriesPoint,
  type PulseActivitySlice,
  type VoteParticipationRow,
} from "@/lib/pulse-aggregates";
import { cn } from "@/lib/utils";

export interface PulseTreeNode {
  id: string;
  parentId: string | null;
  title: string;
  order: number;
  memberCount: number;
  onlineCount: number;
}

export interface PulseVisualizationsProps {
  entries: PulseActivitySlice[];
  treeNodes: PulseTreeNode[];
  currency: string;
}

function maxOfSeries(points: NamedSeriesPoint[]): number {
  let m = 0;
  for (const p of points) m = Math.max(m, p.value);
  return m > 0 ? m : 1;
}

function MiniBarChart({
  points,
  formatValue,
  className,
}: {
  points: NamedSeriesPoint[];
  formatValue: (n: number) => string;
  className?: string;
}) {
  const max = maxOfSeries(points);
  if (points.length === 0) {
    return (
      <p className="text-xs text-foreground/45" role="status">
        —
      </p>
    );
  }
  return (
    <ul
      className={cn("space-y-1.5", className)}
      aria-label="Bar chart"
    >
      {points.map((p) => (
        <li key={p.key} className="flex items-center gap-2 text-xs">
          <span className="w-16 shrink-0 tabular-nums text-foreground/55">
            {p.key.slice(5)}
          </span>
          <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary/80"
              style={{ width: `${Math.min(100, (p.value / max) * 100)}%` }}
            />
          </div>
          <span className="w-24 shrink-0 text-right tabular-nums text-foreground/80">
            {formatValue(p.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function buildChildrenMap(nodes: PulseTreeNode[]) {
  const m = new Map<string | null, PulseTreeNode[]>();
  for (const n of nodes) {
    const p = n.parentId;
    const list = m.get(p) ?? [];
    list.push(n);
    m.set(p, list);
  }
  for (const [, list] of m) {
    list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }
  return m;
}

function VerticalTreeBranches({
  parentId,
  depth,
  childrenOf,
  t,
}: {
  parentId: string | null;
  depth: number;
  childrenOf: Map<string | null, PulseTreeNode[]>;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const children = childrenOf.get(parentId) ?? [];
  if (children.length === 0) return null;
  return (
    <ul
      className={cn("space-y-1", depth > 0 && "mt-1 border-l border-border/60 pl-3")}
    >
      {children.map((n) => (
        <li key={n.id} className="text-sm">
          <div className="font-medium text-foreground">{n.title}</div>
          <div className="text-[11px] text-foreground/50">
            {t("pulse.viz.nodeFootnote", {
              members: n.memberCount,
              online: n.onlineCount,
            })}
          </div>
          <VerticalTreeBranches
            parentId={n.id}
            depth={depth + 1}
            childrenOf={childrenOf}
            t={t}
          />
        </li>
      ))}
    </ul>
  );
}

function VoteParticipationList({
  rows,
  t,
}: {
  rows: VoteParticipationRow[];
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-xs text-foreground/45" role="status">
        {t("pulse.viz.votesNoData")}
      </p>
    );
  }
  return (
    <ul className="space-y-2" aria-label="Vote participation">
      {rows.map((r) => {
        const pct =
          r.participation !== null
            ? Math.round(r.participation * 1000) / 10
            : null;
        const label =
          pct !== null
            ? t("pulse.viz.participationPct", { pct })
            : t("pulse.viz.participationNA");
        return (
          <li key={r.entryId} className="text-xs">
            <div className="flex justify-between gap-2">
              <span className="truncate font-mono text-foreground/70">
                {r.proposalId.length > 10
                  ? `${r.proposalId.slice(0, 8)}…`
                  : r.proposalId}
              </span>
              <span className="shrink-0 tabular-nums text-foreground/80">
                {label}
                {r.quorumReached ? ` · ${t("pulse.viz.quorumOk")}` : ""}
              </span>
            </div>
            {pct !== null && (
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-emerald-600/80 dark:bg-emerald-500/80"
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function PulseVisualizations({
  entries,
  treeNodes,
  currency,
}: PulseVisualizationsProps) {
  const { t } = useI18n();

  const walletSeries = useMemo(
    () => aggregateWalletVolumeByDay(entries, { maxDays: 14 }),
    [entries],
  );
  const taxSeries = useMemo(
    () => aggregateStateTaxByDay(entries, { maxDays: 14 }),
    [entries],
  );
  const voteRows = useMemo(() => extractVoteParticipation(entries), [entries]);
  const childrenOf = useMemo(() => buildChildrenMap(treeNodes), [treeNodes]);

  const fmtVol = (n: number) => formatAmount(n, { currency, withSymbol: true });

  return (
    <section
      className="mb-6 space-y-4"
      aria-label={t("pulse.viz.title")}
    >
      <p className="text-[11px] leading-relaxed text-foreground/45">
        {t("pulse.viz.scopeNote")}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-border/80">
          <CardTitle className="text-base">{t("pulse.viz.transfersTitle")}</CardTitle>
          <CardDescription className="text-xs">
            {t("pulse.viz.transfersDesc")}
          </CardDescription>
          <div className="mt-3">
            {walletSeries.length === 0 ? (
              <p className="text-xs text-foreground/45">{t("pulse.viz.noData")}</p>
            ) : (
              <MiniBarChart points={walletSeries} formatValue={fmtVol} />
            )}
          </div>
        </Card>

        <Card className="border-border/80">
          <CardTitle className="text-base">{t("pulse.viz.taxTitle")}</CardTitle>
          <CardDescription className="text-xs">
            {t("pulse.viz.taxDesc")}
          </CardDescription>
          <div className="mt-3">
            {taxSeries.length === 0 || taxSeries.every((p) => p.value === 0) ? (
              <p className="text-xs text-foreground/45">{t("pulse.viz.taxNoData")}</p>
            ) : (
              <MiniBarChart points={taxSeries} formatValue={fmtVol} />
            )}
          </div>
        </Card>

        <Card className="border-border/80 sm:col-span-2">
          <CardTitle className="text-base">{t("pulse.viz.votesTitle")}</CardTitle>
          <CardDescription className="text-xs">
            {t("pulse.viz.votesDesc")}
          </CardDescription>
          <div className="mt-3 max-h-48 overflow-y-auto pr-1">
            <VoteParticipationList rows={voteRows} t={t} />
          </div>
        </Card>

        <Card className="border-border/80 sm:col-span-2">
          <CardTitle className="text-base">{t("pulse.viz.verticalMapTitle")}</CardTitle>
          <CardDescription className="text-xs">
            {t("pulse.viz.verticalMapDesc")}
          </CardDescription>
          <div className="mt-3 max-h-56 overflow-y-auto text-sm">
            {treeNodes.length === 0 ? (
              <p className="text-xs text-foreground/45">{t("pulse.viz.treeEmpty")}</p>
            ) : (
              <VerticalTreeBranches
                parentId={null}
                depth={0}
                childrenOf={childrenOf}
                t={t}
              />
            )}
          </div>
        </Card>
      </div>
    </section>
  );
}
