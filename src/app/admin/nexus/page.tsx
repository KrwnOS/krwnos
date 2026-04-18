/**
 * `/admin/nexus` — Nexus, главная страница управления Сувереном.
 * ------------------------------------------------------------
 * Это рубка управления всем государством. Сейчас на ней живут три
 * «коренных» карточки, вытянутые из ядра:
 *
 *   1. Вертикаль — число узлов власти + быстрый переход к дереву.
 *   2. Экономика — taxRate, объём валюты и вход в Фабрику Валют.
 *   3. Законы    — 3 последних Proposal из модуля Governance.
 *
 * Авторизация: страница — клиентская, но реальный guard живёт на
 * `/api/admin/nexus`. Если запрос вернул 403 (нет `system.admin` и
 * не Суверен) — делаем `router.replace("/")`, бросая гражданина в
 * общую ленту событий. На 401 (нет/битый токен) показываем форму
 * ввода CLI-токена — тот же сценарий, что у `/admin/economy`.
 *
 * Копирайтинг страницы живёт в `locales/*`; формат чисел/дат и
 * плюрализация узлов проксируются через `useI18n()`.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

type ProposalStatus =
  | "draft"
  | "open"
  | "passed"
  | "rejected"
  | "executed"
  | "expired";

interface ProposalDto {
  id: string;
  title: string;
  status: ProposalStatus;
  createdAt: string;
}

interface PrimaryAssetDto {
  id: string;
  symbol: string;
  name: string;
  taxRate: number;
  totalSupply: number;
  canMint: boolean;
  publicSupply: boolean;
  icon: string | null;
  color: string | null;
}

interface NexusDto {
  state: { id: string };
  vertical: { totalNodes: number };
  economy: {
    primaryAsset: PrimaryAssetDto | null;
    transactionTaxRate: number;
    currencyDisplayName: string | null;
  };
  governance: {
    installed: boolean;
    moduleSlug: string | null;
    proposals: ProposalDto[];
  };
}

const TOKEN_STORAGE_KEY = "krwn.token";
const CITIZEN_FEED_PATH = "/";

export default function AdminNexusPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<NexusDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setToken(window.localStorage.getItem(TOKEN_STORAGE_KEY));
  }, []);

  const reload = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/nexus", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      if (res.status === 403) {
        router.replace(CITIZEN_FEED_PATH);
        return;
      }

      const payload = (await res.json()) as NexusDto | { error: string };
      if (!res.ok) {
        throw new Error(
          "error" in payload ? payload.error : `HTTP ${res.status}`,
        );
      }
      setData(payload as NexusDto);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [token, router]);

  useEffect(() => {
    void reload();
  }, [reload]);

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
      <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-crown">
            {t("nexus.eyebrow")}
          </p>
          <h1 className="mt-1 text-3xl font-semibold">
            {t("nexus.title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-foreground/60">
            {t("nexus.subtitle")}
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
              setData(null);
            }}
          >
            {t("common.logout")}
          </Button>
        </div>
      </header>

      {error && (
        <Card className="mb-6 border-destructive/40 bg-destructive/5 text-sm text-destructive">
          {t("common.errorWith", { message: error })}
          {t("nexus.errorHint")} <code>system.admin</code>.
        </Card>
      )}

      {!data && !error && (
        <Card className="text-sm text-foreground/60">
          {t("nexus.loading")}
        </Card>
      )}

      {data && (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <VerticalCard totalNodes={data.vertical.totalNodes} />
          <EconomyCard
            asset={data.economy.primaryAsset}
            transactionTaxRate={data.economy.transactionTaxRate}
            currencyDisplayName={data.economy.currencyDisplayName}
          />
          <GovernanceCard
            installed={data.governance.installed}
            proposals={data.governance.proposals}
          />
        </section>
      )}
    </Shell>
  );
}

function VerticalCard({ totalNodes }: { totalNodes: number }) {
  const { t, tp } = useI18n();
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <p className="text-[10px] uppercase tracking-[0.3em] text-foreground/50">
          {t("nexus.vertical.eyebrow")}
        </p>
        <CardTitle className="mt-1">{t("nexus.vertical.title")}</CardTitle>
        <CardDescription>{t("nexus.vertical.desc")}</CardDescription>
      </div>

      <div className="flex items-end gap-2">
        <span className="text-4xl font-semibold text-crown">
          {totalNodes}
        </span>
        <span className="pb-1 text-sm text-foreground/60">
          {tp("nexus.vertical.nodes", totalNodes)}
        </span>
      </div>

      <div className="mt-auto flex flex-wrap gap-2">
        <Link href="/admin/vertical">
          <Button variant="crown" size="sm">
            {t("nexus.vertical.addNode")}
          </Button>
        </Link>
        <Link href="/admin/vertical">
          <Button variant="outline" size="sm">
            {t("nexus.vertical.openTree")}
          </Button>
        </Link>
      </div>
    </Card>
  );
}

function EconomyCard({
  asset,
  transactionTaxRate,
  currencyDisplayName,
}: {
  asset: PrimaryAssetDto | null;
  transactionTaxRate: number;
  currencyDisplayName: string | null;
}) {
  const { t, formatPercent, formatNumber } = useI18n();
  const displayName =
    currencyDisplayName ?? asset?.name ?? t("nexus.economy.noCurrency");
  const symbol = asset?.symbol ?? t("common.dash");
  const stateTaxPct = formatPercent(transactionTaxRate);
  const assetTaxPct = asset ? formatPercent(asset.taxRate) : t("common.dash");

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <p className="text-[10px] uppercase tracking-[0.3em] text-foreground/50">
          {t("nexus.economy.eyebrow")}
        </p>
        <CardTitle className="mt-1 flex items-center gap-2">
          <span
            className="text-2xl"
            style={{ color: asset?.color ?? undefined }}
            aria-hidden
          >
            {asset?.icon ?? "⚜"}
          </span>
          {displayName}
          <span className="text-sm font-normal text-foreground/50">
            ({symbol})
          </span>
        </CardTitle>
        <CardDescription>{t("nexus.economy.desc")}</CardDescription>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Stat
          label={t("nexus.economy.stateTax")}
          value={stateTaxPct}
          hint={t("nexus.economy.stateTaxHint")}
        />
        <Stat
          label={t("nexus.economy.assetTax")}
          value={assetTaxPct}
          hint={t("nexus.economy.assetTaxHint")}
        />
        <Stat
          label={t("nexus.economy.supply")}
          value={asset ? formatNumber(asset.totalSupply) : t("common.dash")}
          hint={asset ? symbol : undefined}
          span={2}
        />
      </dl>

      <div className="mt-auto flex flex-wrap gap-2">
        <Link href="/admin/economy">
          <Button variant="crown" size="sm">
            {t("nexus.economy.openFactory")}
          </Button>
        </Link>
        <Link href="/admin/constitution">
          <Button variant="outline" size="sm">
            {t("nexus.economy.openConstitution")}
          </Button>
        </Link>
      </div>
    </Card>
  );
}

function GovernanceCard({
  installed,
  proposals,
}: {
  installed: boolean;
  proposals: ProposalDto[];
}) {
  const { t, formatDate } = useI18n();
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <p className="text-[10px] uppercase tracking-[0.3em] text-foreground/50">
          {t("nexus.governance.eyebrow")}
        </p>
        <CardTitle className="mt-1">{t("nexus.governance.title")}</CardTitle>
        <CardDescription>{t("nexus.governance.desc")}</CardDescription>
      </div>

      {!installed ? (
        <div className="rounded-lg border border-border/60 bg-background/40 p-4 text-sm text-foreground/60">
          {t("nexus.governance.notInstalled.before")}{" "}
          <code>governance</code>{" "}
          {t("nexus.governance.notInstalled.middle")}{" "}
          <code>krwn module install</code>
          {t("nexus.governance.notInstalled.after")}
        </div>
      ) : proposals.length === 0 ? (
        <div className="rounded-lg border border-border/60 bg-background/40 p-4 text-sm text-foreground/60">
          {t("nexus.governance.empty")}
        </div>
      ) : (
        <ul className="space-y-2">
          {proposals.map((p) => (
            <li
              key={p.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-background/40 p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {p.title}
                </p>
                <p className="mt-0.5 text-xs text-foreground/50">
                  {formatDate(p.createdAt)}
                </p>
              </div>
              <StatusBadge status={p.status} />
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex flex-wrap gap-2">
        <Link href="/admin/governance">
          <Button
            variant={installed ? "crown" : "outline"}
            size="sm"
            disabled={!installed}
            title={installed ? undefined : t("nexus.governance.installHint")}
          >
            {t("nexus.governance.open")}
          </Button>
        </Link>
      </div>
    </Card>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12">
      {children}
    </main>
  );
}

function Stat({
  label,
  value,
  hint,
  span,
}: {
  label: string;
  value: string;
  hint?: string;
  span?: 2;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border/60 bg-background/40 p-3",
        span === 2 && "col-span-2",
      )}
    >
      <dt className="text-[10px] uppercase tracking-widest text-foreground/50">
        {label}
      </dt>
      <dd className="mt-1 text-lg font-semibold text-foreground">
        {value}
      </dd>
      {hint && (
        <p className="mt-0.5 text-[10px] uppercase tracking-widest text-foreground/40">
          {hint}
        </p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ProposalStatus }) {
  const { t } = useI18n();
  const tone: Record<ProposalStatus, string> = {
    draft: "border-border text-foreground/60",
    open: "border-crown/60 text-crown",
    passed: "border-emerald-500/50 text-emerald-400",
    rejected: "border-destructive/50 text-destructive",
    executed: "border-emerald-500/50 text-emerald-400",
    expired: "border-border text-foreground/40",
  };
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest",
        tone[status] ?? tone.draft,
      )}
    >
      {t(`nexus.status.${status}`)}
    </span>
  );
}

function TokenPrompt({ onSubmit }: { onSubmit: (token: string) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  return (
    <Card className="mx-auto mt-24 max-w-md">
      <CardTitle>{t("nexus.token.title")}</CardTitle>
      <CardDescription>
        {t("nexus.token.desc.before")} <code>system.admin</code>
        {t("nexus.token.desc.middle")} <code>krwn token mint</code>
        {t("nexus.token.desc.after")}
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
