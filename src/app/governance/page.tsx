/**
 * `/governance` — Парламент.
 * ------------------------------------------------------------
 * Одна страница ведёт граждан через полный жизненный цикл
 * предложения:
 *   1. Видит текущий режим (decree / consultation / auto_dao) и
 *      whitelist ключей, которые Суверен отдал на откуп.
 *   2. Создаёт предложение, выбрав ключ из allowlist-а.
 *   3. Голосует "за / против / воздержаться" по активным
 *      предложениям, видит живой tally и кворум.
 *   4. Сувереном — нажимает "Применить" или "Вето" по закрытым
 *      голосованиям в режиме consultation.
 *
 * Вся копирайтинговая часть живёт в `locales/*` под ключами
 * `governance.*`. Подписи ключей whitelist-а — под
 * `constitution.keys.<fieldName>`, чтобы совпадать со страницей
 * Палаты Указов.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

type GovernanceMode = "decree" | "consultation" | "auto_dao";
type ProposalStatus =
  | "active"
  | "passed"
  | "rejected"
  | "executed"
  | "vetoed"
  | "cancelled"
  | "expired";
type VoteChoice = "for" | "against" | "abstain";
type WeightStrategy =
  | "one_person_one_vote"
  | "by_node_weight"
  | "by_balance";

interface GovernanceRulesDto {
  mode: GovernanceMode;
  sovereignVeto: boolean;
  quorumBps: number;
  thresholdBps: number;
  votingDurationSeconds: number;
  weightStrategy: WeightStrategy;
  nodeWeights: Record<string, number>;
  balanceAssetId: string | null;
  minProposerPermission: string | null;
  minProposerBalance: number | null;
  allowedConfigKeys: string[];
}

interface StateSettingsDto {
  governanceRules: GovernanceRulesDto;
}

interface ProposalDto {
  id: string;
  stateId: string;
  createdById: string;
  title: string;
  description: string;
  targetConfigKey: string;
  newValue: unknown;
  status: ProposalStatus;
  quorumBps: number;
  thresholdBps: number;
  weightStrategy: string;
  modeAtCreation: GovernanceMode;
  sovereignVetoAtCreation: boolean;
  totalWeightFor: number;
  totalWeightAgainst: number;
  totalWeightAbstain: number;
  voteCount: number;
  executedById: string | null;
  vetoedById: string | null;
  vetoReason: string | null;
  expiresAt: string;
  createdAt: string;
  closedAt: string | null;
  executedAt: string | null;
}

interface VoteDto {
  id: string;
  proposalId: string;
  userId: string;
  choice: VoteChoice;
  weight: number;
  weightReason: string;
  comment: string | null;
  createdAt: string;
}

interface TallyDto {
  forWeight: number;
  againstWeight: number;
  abstainWeight: number;
  totalCastWeight: number;
  voteCount: number;
  quorumReached: boolean;
  thresholdReached: boolean;
  willPass: boolean;
  electorateSize: number;
}

const TOKEN_STORAGE_KEY = "krwn.token";

// All config keys Parliament can touch, mirrored from
// `/admin/constitution`. We only use the list for iteration —
// their labels come from `constitution.keys.*` in the locale.
const ALL_KEYS = [
  "transactionTaxRate",
  "incomeTaxRate",
  "roleTaxRate",
  "currencyDisplayName",
  "citizenshipFeeAmount",
  "rolesPurchasable",
  "exitRefundRate",
  "permissionInheritance",
  "autoPromotionEnabled",
  "autoPromotionMinBalance",
  "autoPromotionMinDays",
  "autoPromotionTargetNodeId",
  "treasuryTransparency",
] as const;

export default function GovernancePage() {
  const { t, formatCompact, formatDateTime } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [rules, setRules] = useState<GovernanceRulesDto | null>(null);
  const [proposals, setProposals] = useState<ProposalDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [filter, setFilter] = useState<"active" | "closed" | "all">("active");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setToken(window.localStorage.getItem(TOKEN_STORAGE_KEY));
  }, []);

  const reload = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [rulesRes, proposalsRes] = await Promise.all([
        fetch("/api/state/constitution", {
          headers: { authorization: `Bearer ${token}` },
        }),
        fetch("/api/governance/proposals?limit=200", {
          headers: { authorization: `Bearer ${token}` },
        }),
      ]);
      const rulesBody = (await rulesRes.json()) as
        | { settings: StateSettingsDto }
        | { error: string };
      if (!rulesRes.ok || !("settings" in rulesBody)) {
        throw new Error(
          "error" in rulesBody
            ? typeof rulesBody.error === "string"
              ? rulesBody.error
              : JSON.stringify(rulesBody.error)
            : `HTTP ${rulesRes.status}`,
        );
      }
      setRules(rulesBody.settings.governanceRules);

      const pb = (await proposalsRes.json()) as
        | { proposals: ProposalDto[] }
        | { error: string };
      if (!proposalsRes.ok || !("proposals" in pb)) {
        throw new Error(
          "error" in pb
            ? typeof pb.error === "string"
              ? pb.error
              : JSON.stringify(pb.error)
            : `HTTP ${proposalsRes.status}`,
        );
      }
      setProposals(pb.proposals);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    if (filter === "all") return proposals;
    if (filter === "active") return proposals.filter((p) => p.status === "active");
    return proposals.filter((p) => p.status !== "active");
  }, [proposals, filter]);

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
            {t("governance.eyebrow")}
          </p>
          <h1 className="mt-1 text-3xl font-semibold">
            {t("governance.title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-foreground/60">
            {t("governance.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void reload()}
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
              setProposals([]);
              setRules(null);
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
          {flash}
        </Card>
      )}

      {rules && <RulesOverview rules={rules} />}

      {rules && (
        <CreateProposalForm
          rules={rules}
          token={token}
          onCreated={() => {
            setFlash(t("governance.flash.created"));
            void reload();
          }}
        />
      )}

      <div className="mb-4 mt-10 flex items-center gap-2">
        <FilterButton current={filter} value="active" onClick={setFilter}>
          {t("governance.filter.active")}
        </FilterButton>
        <FilterButton current={filter} value="closed" onClick={setFilter}>
          {t("governance.filter.closed")}
        </FilterButton>
        <FilterButton current={filter} value="all" onClick={setFilter}>
          {t("governance.filter.all")}
        </FilterButton>
      </div>

      <div className="space-y-4">
        {filtered.length === 0 && !loading && (
          <Card className="text-sm text-foreground/60">
            {t("governance.empty.prefix")}{" "}
            {filter === "active"
              ? t("governance.empty.active")
              : t("governance.empty.other")}
          </Card>
        )}
        {filtered.map((p) => (
          <ProposalCard
            key={p.id}
            proposal={p}
            token={token}
            onChanged={(msg) => {
              if (msg) setFlash(msg);
              void reload();
            }}
            formatCompact={formatCompact}
            formatDateTime={formatDateTime}
          />
        ))}
      </div>
    </Shell>
  );
}

function RulesOverview({ rules }: { rules: GovernanceRulesDto }) {
  const { t, formatDuration } = useI18n();
  const allowed =
    rules.allowedConfigKeys.includes("*")
      ? ALL_KEYS.slice()
      : rules.allowedConfigKeys;

  const modeLabel =
    rules.mode === "decree"
      ? t("governance.mode.decree")
      : rules.mode === "consultation"
        ? t("governance.mode.consultation")
        : t("governance.mode.auto");

  const weightLabel =
    rules.weightStrategy === "by_node_weight"
      ? t("governance.rules.weight.node")
      : rules.weightStrategy === "by_balance"
        ? t("governance.rules.weight.balance")
        : t("governance.rules.weight.person");

  return (
    <Card className="mb-6">
      <CardTitle>{t("governance.rules.title")}</CardTitle>
      <CardDescription>
        <DescriptionWithLink
          template={t("governance.rules.desc", { link: "%%LINK%%" })}
          linkHref="/admin/constitution"
          linkText={t("governance.rules.link")}
        />
      </CardDescription>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <Stat label={t("governance.rules.mode")} value={modeLabel} />
        <Stat
          label={t("governance.rules.quorum")}
          value={t("governance.rules.quorumValue", {
            pct: (rules.quorumBps / 100).toFixed(2),
          })}
        />
        <Stat
          label={t("governance.rules.threshold")}
          value={t("governance.rules.thresholdValue", {
            pct: (rules.thresholdBps / 100).toFixed(2),
          })}
        />
        <Stat
          label={t("governance.rules.duration")}
          value={formatDuration(rules.votingDurationSeconds)}
        />
        <Stat label={t("governance.rules.weight")} value={weightLabel} />
        <Stat
          label={t("governance.rules.veto")}
          value={rules.sovereignVeto ? t("common.on") : t("common.off")}
        />
      </dl>
      <div className="mt-4">
        <p className="text-xs uppercase tracking-wider text-foreground/50">
          {t("governance.rules.allowed")}
        </p>
        {allowed.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/60">
            {t("governance.rules.allowedEmpty")}
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {allowed.map((k) => (
              <span
                key={k}
                className="rounded-md border border-border/60 bg-background/60 px-2 py-1 font-mono text-xs"
                title={t(`constitution.keys.${k}`)}
              >
                {k}
              </span>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function CreateProposalForm({
  rules,
  token,
  onCreated,
}: {
  rules: GovernanceRulesDto;
  token: string;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const allowed =
    rules.allowedConfigKeys.includes("*")
      ? ALL_KEYS.slice()
      : rules.allowedConfigKeys;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetKey, setTargetKey] = useState<string>(allowed[0] ?? "");
  const [newValue, setNewValue] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed.includes(targetKey) && allowed[0]) {
      setTargetKey(allowed[0]);
    }
  }, [allowed, targetKey]);

  if (allowed.length === 0) return null;
  if (rules.mode === "decree") {
    return (
      <Card className="mb-2 border-dashed text-sm text-foreground/60">
        {t("governance.create.disabledByDecree")}
      </Card>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetKey || !title.trim() || !description.trim()) return;
    setSubmitting(true);
    setErr(null);
    try {
      const parsed = coerceValue(targetKey, newValue, t);
      const res = await fetch("/api/governance/proposals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          targetConfigKey: targetKey,
          newValue: parsed,
        }),
      });
      const body = (await res.json()) as
        | { proposal: ProposalDto }
        | { error: unknown };
      if (!res.ok) {
        throw new Error(
          "error" in body
            ? typeof body.error === "string"
              ? body.error
              : JSON.stringify(body.error)
            : `HTTP ${res.status}`,
        );
      }
      setTitle("");
      setDescription("");
      setNewValue("");
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="mb-6">
      <CardTitle>{t("governance.create.title")}</CardTitle>
      <CardDescription>{t("governance.create.desc")}</CardDescription>
      <form className="mt-4 space-y-4" onSubmit={onSubmit}>
        <div>
          <Label>{t("governance.create.name")}</Label>
          <Input
            className="mt-1"
            placeholder={t("governance.create.namePh")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
        </div>
        <div>
          <Label>{t("governance.create.why")}</Label>
          <textarea
            className="mt-1 min-h-[100px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder={t("governance.create.whyPh")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={8000}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>{t("governance.create.key")}</Label>
            <select
              className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
              value={targetKey}
              onChange={(e) => setTargetKey(e.target.value)}
            >
              {allowed.map((k) => (
                <option key={k} value={k}>
                  {t(`constitution.keys.${k}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>{t("governance.create.value")}</Label>
            <Input
              className="mt-1 font-mono"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder={valueHint(targetKey, t)}
            />
            <p className="mt-1 text-[11px] text-foreground/50">
              {valueHint(targetKey, t)}
            </p>
          </div>
        </div>
        {err && (
          <p className="text-xs text-destructive">
            {t("common.errorWith", { message: err })}
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" variant="crown" disabled={submitting}>
            {submitting
              ? t("governance.create.submitting")
              : t("governance.create.submit")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ProposalCard({
  proposal,
  token,
  onChanged,
  formatCompact,
  formatDateTime,
}: {
  proposal: ProposalDto;
  token: string;
  onChanged: (msg?: string) => void;
  formatCompact: (n: number) => string;
  formatDateTime: (d: string | Date) => string;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [tally, setTally] = useState<TallyDto | null>(null);
  const [votes, setVotes] = useState<VoteDto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    const res = await fetch(
      `/api/governance/proposals/${proposal.id}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const body = (await res.json()) as
      | { proposal: ProposalDto; votes: VoteDto[]; tally: TallyDto }
      | { error: string };
    if (res.ok && "tally" in body) {
      setTally(body.tally);
      setVotes(body.votes);
    }
  }, [proposal.id, token]);

  useEffect(() => {
    if (expanded && !tally) void loadDetail();
  }, [expanded, tally, loadDetail]);

  const vote = async (choice: VoteChoice) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/governance/proposals/${proposal.id}/vote`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ choice }),
        },
      );
      const body = (await res.json()) as { error?: unknown };
      if (!res.ok) {
        throw new Error(
          typeof body.error === "string"
            ? body.error
            : JSON.stringify(body.error ?? `HTTP ${res.status}`),
        );
      }
      await loadDetail();
      onChanged(t("governance.flash.voted"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const actOn = async (path: "execute" | "veto") => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/governance/proposals/${proposal.id}/${path}`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        },
      );
      const body = (await res.json()) as { error?: unknown };
      if (!res.ok) {
        throw new Error(
          typeof body.error === "string"
            ? body.error
            : JSON.stringify(body.error ?? `HTTP ${res.status}`),
        );
      }
      onChanged(
        path === "execute"
          ? t("governance.flash.executed")
          : t("governance.flash.vetoed"),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const statusTint =
    proposal.status === "active"
      ? "text-crown"
      : proposal.status === "passed" || proposal.status === "executed"
        ? "text-emerald-500"
        : proposal.status === "vetoed"
          ? "text-amber-500"
          : "text-foreground/60";

  const modeShortKey =
    proposal.modeAtCreation === "auto_dao"
      ? "governance.mode.short.auto"
      : proposal.modeAtCreation === "consultation"
        ? "governance.mode.short.consultation"
        : "governance.mode.short.decree";

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest">
            <span className={cn("font-semibold", statusTint)}>
              {t(`governance.status.${proposal.status}`)}
            </span>
            <span className="text-foreground/40">•</span>
            <span className="text-foreground/50">{t(modeShortKey)}</span>
          </div>
          <h2 className="mt-1 text-lg font-semibold">{proposal.title}</h2>
          <p className="mt-1 text-xs text-foreground/50">
            <span className="font-mono">{proposal.targetConfigKey}</span>{" "}
            →{" "}
            <span className="font-mono">
              {JSON.stringify(proposal.newValue)}
            </span>
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t("common.collapse") : t("common.details")}
        </Button>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-foreground/60 sm:grid-cols-4">
        <Counter
          label={t("governance.proposal.count.for")}
          value={proposal.totalWeightFor}
          tone="pos"
          fmt={formatCompact}
        />
        <Counter
          label={t("governance.proposal.count.against")}
          value={proposal.totalWeightAgainst}
          tone="neg"
          fmt={formatCompact}
        />
        <Counter
          label={t("governance.proposal.count.abstain")}
          value={proposal.totalWeightAbstain}
          fmt={formatCompact}
        />
        <Counter
          label={t("governance.proposal.count.votes")}
          value={proposal.voteCount}
          fmt={formatCompact}
        />
      </div>

      {expanded && (
        <div className="mt-4 space-y-4 border-t border-border/60 pt-4 text-sm">
          <p className="whitespace-pre-wrap text-foreground/80">
            {proposal.description}
          </p>

          {tally && (
            <div className="grid gap-2 rounded-md border border-border/50 bg-background/40 p-3 text-xs sm:grid-cols-4">
              <Stat
                label={t("governance.proposal.tally.quorum")}
                value={
                  tally.quorumReached
                    ? t("governance.proposal.tally.quorumReached", {
                        cast: formatCompact(tally.totalCastWeight),
                        total: formatCompact(tally.electorateSize),
                      })
                    : `${formatCompact(tally.totalCastWeight)}/${formatCompact(tally.electorateSize)}`
                }
              />
              <Stat
                label={t("governance.proposal.tally.threshold")}
                value={
                  tally.thresholdReached
                    ? t("governance.proposal.tally.thresholdPassed")
                    : t("governance.proposal.tally.thresholdFailed")
                }
              />
              <Stat
                label={t("governance.proposal.tally.forecast")}
                value={
                  tally.willPass
                    ? t("governance.proposal.tally.willPass")
                    : t("governance.proposal.tally.willReject")
                }
              />
              <Stat
                label={t("governance.proposal.tally.expires")}
                value={formatDateTime(proposal.expiresAt)}
              />
            </div>
          )}

          {proposal.status === "active" && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void vote("for")}
              >
                {t("governance.proposal.vote.for")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void vote("against")}
              >
                {t("governance.proposal.vote.against")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void vote("abstain")}
              >
                {t("governance.proposal.vote.abstain")}
              </Button>
              {proposal.sovereignVetoAtCreation && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void actOn("veto")}
                >
                  {t("governance.proposal.veto")}
                </Button>
              )}
            </div>
          )}

          {proposal.status === "passed" &&
            proposal.modeAtCreation === "consultation" && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="crown"
                  size="sm"
                  disabled={busy}
                  onClick={() => void actOn("execute")}
                >
                  {t("governance.proposal.applyExecute")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void actOn("veto")}
                >
                  {t("governance.proposal.vetoShort")}
                </Button>
              </div>
            )}

          {proposal.status === "vetoed" && proposal.vetoReason && (
            <p className="text-xs text-amber-500">
              {t("governance.proposal.vetoReason", {
                reason: proposal.vetoReason,
              })}
            </p>
          )}

          {err && (
            <p className="text-xs text-destructive">
              {t("common.errorWith", { message: err })}
            </p>
          )}

          {votes && votes.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-foreground/50">
                {t("governance.proposal.votesHeader", { count: votes.length })}
              </p>
              <ul className="mt-2 space-y-1 text-xs">
                {votes.map((v) => (
                  <li
                    key={v.id}
                    className="flex items-center gap-2 text-foreground/70"
                  >
                    <span className="font-mono text-foreground/50">
                      {v.userId.slice(0, 10)}…
                    </span>
                    <span
                      className={cn(
                        "font-semibold",
                        v.choice === "for" && "text-emerald-500",
                        v.choice === "against" && "text-red-500",
                      )}
                    >
                      {v.choice === "for"
                        ? t("governance.proposal.vote.short.for")
                        : v.choice === "against"
                          ? t("governance.proposal.vote.short.against")
                          : t("common.dash")}
                    </span>
                    <span className="text-foreground/40">
                      × {formatCompact(v.weight)}
                    </span>
                    {v.comment && (
                      <span className="text-foreground/60">— {v.comment}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
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

/**
 * Splits a translation template that contains a single `%%LINK%%`
 * token into plain text + an anchor. The template is always
 * "…{link}…" in the locale — we interpolate with a known marker
 * rather than raw JSX so the locale file stays string-only.
 */
function DescriptionWithLink({
  template,
  linkHref,
  linkText,
}: {
  template: string;
  linkHref: string;
  linkText: string;
}) {
  const parts = template.split("%%LINK%%");
  return (
    <>
      {parts[0]}
      <a href={linkHref} className="underline decoration-dotted">
        {linkText}
      </a>
      {parts[1] ?? ""}
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-[11px] font-semibold uppercase tracking-widest text-foreground/60">
      {children}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-foreground/50">
        {label}
      </p>
      <p className="mt-0.5 text-sm text-foreground/80">{value}</p>
    </div>
  );
}

function Counter({
  label,
  value,
  tone,
  fmt,
}: {
  label: string;
  value: number;
  tone?: "pos" | "neg";
  fmt: (n: number) => string;
}) {
  const color =
    tone === "pos"
      ? "text-emerald-500"
      : tone === "neg"
        ? "text-red-500"
        : "text-foreground/70";
  return (
    <div className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-foreground/50">
        {label}
      </p>
      <p className={cn("mt-0.5 text-sm font-semibold", color)}>{fmt(value)}</p>
    </div>
  );
}

function FilterButton({
  current,
  value,
  onClick,
  children,
}: {
  current: string;
  value: "active" | "closed" | "all";
  onClick: (next: "active" | "closed" | "all") => void;
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

function TokenPrompt({ onSubmit }: { onSubmit: (token: string) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  return (
    <Card className="mx-auto mt-24 max-w-md">
      <CardTitle>{t("governance.token.title")}</CardTitle>
      <CardDescription>
        {t("governance.token.desc", { cmd: "krwn token mint" })}
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

function valueHint(
  key: string,
  t: (k: string, vars?: Record<string, string | number>) => string,
): string {
  const numericRate = [
    "transactionTaxRate",
    "incomeTaxRate",
    "roleTaxRate",
    "exitRefundRate",
  ];
  const numericAmount = [
    "citizenshipFeeAmount",
    "autoPromotionMinBalance",
    "autoPromotionMinDays",
  ];
  const boolKeys = [
    "rolesPurchasable",
    "permissionInheritance",
    "autoPromotionEnabled",
  ];
  if (numericRate.includes(key)) return t("governance.hint.rate");
  if (numericAmount.includes(key)) return t("governance.hint.amount");
  if (boolKeys.includes(key)) return t("governance.hint.bool");
  if (key === "treasuryTransparency") return t("governance.hint.transparency");
  if (key === "currencyDisplayName" || key === "autoPromotionTargetNodeId") {
    return t("governance.hint.string");
  }
  return t("governance.hint.jsonFallback");
}

function coerceValue(
  key: string,
  raw: string,
  t: (k: string) => string,
): unknown {
  const trimmed = raw.trim();
  const numericRate = [
    "transactionTaxRate",
    "incomeTaxRate",
    "roleTaxRate",
    "exitRefundRate",
  ];
  const numericAmount = ["citizenshipFeeAmount", "autoPromotionMinBalance"];
  const numericInt = ["autoPromotionMinDays"];
  const boolKeys = [
    "rolesPurchasable",
    "permissionInheritance",
    "autoPromotionEnabled",
  ];
  if (numericRate.includes(key)) {
    const n = Number(trimmed);
    if (!Number.isFinite(n)) throw new Error(t("governance.coerce.numberNeeded"));
    return n;
  }
  if (numericAmount.includes(key)) {
    if (trimmed === "") return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(t("governance.coerce.nonNeg"));
    }
    return n;
  }
  if (numericInt.includes(key)) {
    if (trimmed === "") return null;
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(t("governance.coerce.intNonNeg"));
    }
    return n;
  }
  if (boolKeys.includes(key)) {
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    throw new Error(t("governance.coerce.bool"));
  }
  if (key === "treasuryTransparency") {
    if (
      trimmed !== "public" &&
      trimmed !== "council" &&
      trimmed !== "sovereign"
    ) {
      throw new Error(t("governance.coerce.transparency"));
    }
    return trimmed;
  }
  if (key === "currencyDisplayName" || key === "autoPromotionTargetNodeId") {
    return trimmed === "" ? null : trimmed;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}
