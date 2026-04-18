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
 * Транспорт идентичен остальным админским страницам: CLI-токен
 * хранится в `localStorage["krwn.token"]`. Серверные guard-ы
 * (permissions → 403) отрисовываются как inline-ошибки, а не
 * полный redirect — так гражданин видит ленту, даже если у него
 * нет права голосовать.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------
// Wire types
// ------------------------------------------------------------

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

interface GovernanceRulesDto {
  mode: GovernanceMode;
  sovereignVeto: boolean;
  quorumBps: number;
  thresholdBps: number;
  votingDurationSeconds: number;
  weightStrategy:
    | "one_person_one_vote"
    | "by_node_weight"
    | "by_balance";
  nodeWeights: Record<string, number>;
  balanceAssetId: string | null;
  minProposerPermission: string | null;
  minProposerBalance: number | null;
  allowedConfigKeys: string[];
}

interface StateSettingsDto {
  governanceRules: GovernanceRulesDto;
  // (остальные поля нас на этой странице не интересуют)
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

// ------------------------------------------------------------

const KEY_LABELS: Record<string, string> = {
  transactionTaxRate: "Налог на перевод (0..1)",
  incomeTaxRate: "Подоходный налог (0..1)",
  roleTaxRate: "Налог на роль (0..1)",
  currencyDisplayName: "Витрина валюты (строка)",
  citizenshipFeeAmount: "Плата за гражданство",
  rolesPurchasable: "Выкуп ролей (true/false)",
  exitRefundRate: "Возврат при выходе (0..1)",
  permissionInheritance: "Наследование прав (true/false)",
  autoPromotionEnabled: "Авто-продвижение (true/false)",
  autoPromotionMinBalance: "Порог баланса",
  autoPromotionMinDays: "Стаж, дней",
  autoPromotionTargetNodeId: "Целевой узел (id)",
  treasuryTransparency: "Прозрачность казны (public|council|sovereign)",
};

const MODE_LABELS: Record<GovernanceMode, string> = {
  decree: "Указ — меняет только Суверен",
  consultation: "Консультация — голос совещательный",
  auto_dao: "Auto-DAO — успешное решение применяется автоматически",
};

const STATUS_LABELS: Record<ProposalStatus, string> = {
  active: "Идёт голосование",
  passed: "Принято",
  rejected: "Отклонено",
  executed: "Исполнено",
  vetoed: "Вето",
  cancelled: "Отозвано",
  expired: "Истёк срок",
};

// ------------------------------------------------------------

export default function GovernancePage() {
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
            Парламент
          </p>
          <h1 className="mt-1 text-3xl font-semibold">Ассамблея предложений</h1>
          <p className="mt-2 max-w-2xl text-sm text-foreground/60">
            Здесь граждане предлагают изменения к конституции. Режим
            голосования выбирает Суверен — Парламент может быть чисто
            совещательным, а может автоматически менять правила
            государства по решению большинства.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void reload()}
            disabled={loading}
          >
            {loading ? "…" : "Обновить"}
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
            Сменить токен
          </Button>
        </div>
      </header>

      {error && (
        <Card className="mb-6 border-destructive/40 bg-destructive/5 text-sm text-destructive">
          Ошибка: {error}
        </Card>
      )}

      {flash && (
        <Card className="mb-6 border-crown/40 bg-crown/5 text-sm text-crown">
          {flash}
        </Card>
      )}

      {rules && (
        <RulesOverview rules={rules} />
      )}

      {rules && <CreateProposalForm
        rules={rules}
        token={token}
        onCreated={() => {
          setFlash("Предложение опубликовано.");
          void reload();
        }}
      />}

      <div className="mb-4 mt-10 flex items-center gap-2">
        <FilterButton current={filter} value="active" onClick={setFilter}>
          Активные
        </FilterButton>
        <FilterButton current={filter} value="closed" onClick={setFilter}>
          Завершённые
        </FilterButton>
        <FilterButton current={filter} value="all" onClick={setFilter}>
          Все
        </FilterButton>
      </div>

      <div className="space-y-4">
        {filtered.length === 0 && !loading && (
          <Card className="text-sm text-foreground/60">
            Предложений не найдено. {filter === "active"
              ? "Все голосования закрыты — или никто ещё не внёс ни одного предложения."
              : "Попробуйте другой фильтр."}
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
          />
        ))}
      </div>
    </Shell>
  );
}

// ------------------------------------------------------------

function RulesOverview({ rules }: { rules: GovernanceRulesDto }) {
  const allowed =
    rules.allowedConfigKeys.includes("*")
      ? Object.keys(KEY_LABELS)
      : rules.allowedConfigKeys;

  return (
    <Card className="mb-6">
      <CardTitle>Правила Парламента</CardTitle>
      <CardDescription>
        Снимок «конституции самого голосования». Редактируется только
        Сувереном через <a href="/admin/constitution" className="underline decoration-dotted">Палату Указов</a>.
      </CardDescription>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <Stat label="Режим" value={MODE_LABELS[rules.mode]} />
        <Stat
          label="Кворум"
          value={`${(rules.quorumBps / 100).toFixed(2)}% от электората`}
        />
        <Stat
          label="Порог принятия"
          value={`${(rules.thresholdBps / 100).toFixed(2)}% "за"`}
        />
        <Stat
          label="Длительность"
          value={formatDuration(rules.votingDurationSeconds)}
        />
        <Stat
          label="Стратегия веса"
          value={formatStrategy(rules.weightStrategy)}
        />
        <Stat
          label="Право вето Суверена"
          value={rules.sovereignVeto ? "включено" : "выключено"}
        />
      </dl>
      <div className="mt-4">
        <p className="text-xs uppercase tracking-wider text-foreground/50">
          Разрешённые к изменению ключи
        </p>
        {allowed.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/60">
            Суверен пока не отдал ни одного параметра на откуп. Подавать
            предложения невозможно.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {allowed.map((k) => (
              <span
                key={k}
                className="rounded-md border border-border/60 bg-background/60 px-2 py-1 font-mono text-xs"
                title={KEY_LABELS[k] ?? k}
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

// ------------------------------------------------------------

function CreateProposalForm({
  rules,
  token,
  onCreated,
}: {
  rules: GovernanceRulesDto;
  token: string;
  onCreated: () => void;
}) {
  const allowed =
    rules.allowedConfigKeys.includes("*")
      ? Object.keys(KEY_LABELS)
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
        Текущий режим — «Указ». Предложения граждан отключены.
      </Card>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetKey || !title.trim() || !description.trim()) return;
    setSubmitting(true);
    setErr(null);
    try {
      const parsed = coerceValue(targetKey, newValue);
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
      setErr(e instanceof Error ? e.message : "ошибка");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="mb-6">
      <CardTitle>Новое предложение</CardTitle>
      <CardDescription>
        Выберите ключ из whitelist-а Суверена и предложите его новое
        значение. Значение автоматически конвертируется в правильный
        тип (число / bool / строка / null) — шпаргалка рядом с полем.
      </CardDescription>
      <form className="mt-4 space-y-4" onSubmit={onSubmit}>
        <div>
          <Label>Название</Label>
          <Input
            className="mt-1"
            placeholder="Снизить налог на перевод до 1%"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
        </div>
        <div>
          <Label>Обоснование</Label>
          <textarea
            className="mt-1 min-h-[100px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="Почему это стоит принять. Какие риски."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={8000}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Параметр конституции</Label>
            <select
              className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
              value={targetKey}
              onChange={(e) => setTargetKey(e.target.value)}
            >
              {allowed.map((k) => (
                <option key={k} value={k}>
                  {KEY_LABELS[k] ?? k}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Новое значение</Label>
            <Input
              className="mt-1 font-mono"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder={valueHint(targetKey)}
            />
            <p className="mt-1 text-[11px] text-foreground/50">
              {valueHint(targetKey)}
            </p>
          </div>
        </div>
        {err && <p className="text-xs text-destructive">Ошибка: {err}</p>}
        <div className="flex justify-end">
          <Button type="submit" variant="crown" disabled={submitting}>
            {submitting ? "Публикую…" : "Опубликовать"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ------------------------------------------------------------

function ProposalCard({
  proposal,
  token,
  onChanged,
}: {
  proposal: ProposalDto;
  token: string;
  onChanged: (msg?: string) => void;
}) {
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
      onChanged("Голос учтён.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ошибка");
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
        path === "execute" ? "Решение применено." : "Предложение получило вето.",
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ошибка");
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

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest">
            <span className={cn("font-semibold", statusTint)}>
              {STATUS_LABELS[proposal.status]}
            </span>
            <span className="text-foreground/40">•</span>
            <span className="text-foreground/50">
              {proposal.modeAtCreation === "auto_dao"
                ? "auto-DAO"
                : proposal.modeAtCreation === "consultation"
                  ? "консультация"
                  : "указ"}
            </span>
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
          {expanded ? "Свернуть" : "Подробнее"}
        </Button>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-foreground/60 sm:grid-cols-4">
        <Counter label="За" value={proposal.totalWeightFor} tone="pos" />
        <Counter label="Против" value={proposal.totalWeightAgainst} tone="neg" />
        <Counter label="Воздержались" value={proposal.totalWeightAbstain} />
        <Counter label="Голосов" value={proposal.voteCount} />
      </div>

      {expanded && (
        <div className="mt-4 space-y-4 border-t border-border/60 pt-4 text-sm">
          <p className="whitespace-pre-wrap text-foreground/80">
            {proposal.description}
          </p>

          {tally && (
            <div className="grid gap-2 rounded-md border border-border/50 bg-background/40 p-3 text-xs sm:grid-cols-4">
              <Stat
                label="Кворум"
                value={
                  tally.quorumReached
                    ? `достигнут (${fmt(tally.totalCastWeight)}/${fmt(tally.electorateSize)})`
                    : `${fmt(tally.totalCastWeight)}/${fmt(tally.electorateSize)}`
                }
              />
              <Stat
                label="Порог"
                value={
                  tally.thresholdReached
                    ? "пройден"
                    : "не пройден"
                }
              />
              <Stat
                label="Прогноз"
                value={tally.willPass ? "будет принято" : "будет отклонено"}
              />
              <Stat
                label="Истекает"
                value={new Date(proposal.expiresAt).toLocaleString()}
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
                За
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void vote("against")}
              >
                Против
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void vote("abstain")}
              >
                Воздержаться
              </Button>
              {proposal.sovereignVetoAtCreation && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void actOn("veto")}
                >
                  Наложить вето
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
                  Применить решение
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void actOn("veto")}
                >
                  Вето
                </Button>
              </div>
            )}

          {proposal.status === "vetoed" && proposal.vetoReason && (
            <p className="text-xs text-amber-500">
              Причина вето: {proposal.vetoReason}
            </p>
          )}

          {err && <p className="text-xs text-destructive">Ошибка: {err}</p>}

          {votes && votes.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-foreground/50">
                Голоса ({votes.length})
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
                        ? "за"
                        : v.choice === "against"
                          ? "против"
                          : "—"}
                    </span>
                    <span className="text-foreground/40">× {fmt(v.weight)}</span>
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

// ------------------------------------------------------------
// Shared helpers
// ------------------------------------------------------------

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12">
      {children}
    </main>
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
}: {
  label: string;
  value: number;
  tone?: "pos" | "neg";
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
  const [value, setValue] = useState("");
  return (
    <Card className="mx-auto mt-24 max-w-md">
      <CardTitle>Вход в Парламент</CardTitle>
      <CardDescription>
        Голосование и подача предложений требуют CLI-токен гражданина.
        Получите его через <code>krwn token mint</code>.
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
          Войти
        </Button>
      </form>
    </Card>
  );
}

function fmt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}k`;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const mins = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}д ${hours}ч`;
  if (hours > 0) return `${hours}ч ${mins}м`;
  return `${mins}м`;
}

function formatStrategy(s: string): string {
  if (s === "by_node_weight") return "по весу узла";
  if (s === "by_balance") return "по балансу кошелька";
  return "один человек — один голос";
}

function valueHint(key: string): string {
  const numericRate = ["transactionTaxRate", "incomeTaxRate", "roleTaxRate", "exitRefundRate"];
  const numericAmount = ["citizenshipFeeAmount", "autoPromotionMinBalance", "autoPromotionMinDays"];
  const boolKeys = ["rolesPurchasable", "permissionInheritance", "autoPromotionEnabled"];
  if (numericRate.includes(key)) return "Например: 0.05 (=5%). Диапазон 0..1.";
  if (numericAmount.includes(key)) return "Целое или дробное число ≥ 0. Пусто → null.";
  if (boolKeys.includes(key)) return "true или false";
  if (key === "treasuryTransparency") return "public | council | sovereign";
  if (key === "currencyDisplayName" || key === "autoPromotionTargetNodeId") {
    return "Строка (пусто → null)";
  }
  return "JSON-совместимое значение";
}

function coerceValue(key: string, raw: string): unknown {
  const trimmed = raw.trim();
  const numericRate = ["transactionTaxRate", "incomeTaxRate", "roleTaxRate", "exitRefundRate"];
  const numericAmount = ["citizenshipFeeAmount", "autoPromotionMinBalance"];
  const numericInt = ["autoPromotionMinDays"];
  const boolKeys = ["rolesPurchasable", "permissionInheritance", "autoPromotionEnabled"];
  if (numericRate.includes(key)) {
    const n = Number(trimmed);
    if (!Number.isFinite(n)) throw new Error("Ожидается число.");
    return n;
  }
  if (numericAmount.includes(key)) {
    if (trimmed === "") return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) throw new Error("Ожидается число ≥ 0.");
    return n;
  }
  if (numericInt.includes(key)) {
    if (trimmed === "") return null;
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 0) throw new Error("Ожидается целое ≥ 0.");
    return n;
  }
  if (boolKeys.includes(key)) {
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    throw new Error("Ожидается true или false.");
  }
  if (key === "treasuryTransparency") {
    if (trimmed !== "public" && trimmed !== "council" && trimmed !== "sovereign") {
      throw new Error("public | council | sovereign");
    }
    return trimmed;
  }
  if (key === "currencyDisplayName" || key === "autoPromotionTargetNodeId") {
    return trimmed === "" ? null : trimmed;
  }
  // fallback — JSON literal
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}
