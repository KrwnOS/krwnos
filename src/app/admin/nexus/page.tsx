/**
 * `/admin/nexus` — Nexus, главная рубка Суверена.
 * ------------------------------------------------------------
 * Стерильный и функциональный дашборд в стиле Minimalist High-Tech:
 * Anthracite-фон, золотые волосяные границы (`border-primary/20`),
 * тонкий бекдроп-блюр для карточек и модалок (glassmorphism).
 *
 * Содержание:
 *   1. Header — название государства, slug / handle Суверена и
 *      системный heartbeat (зелёная точка Online + Synchronized /
 *      Syncing… в зависимости от состояния последнего fetch-а).
 *   2. Grid:
 *        * Вертикаль — инфографика: число узлов и число активных
 *          граждан. Быстрые действия: «Добавить узел», «Открыть
 *          дерево».
 *        * Экономика — объём валюты в обороте, два налога (штата +
 *          актива) и кнопка «Эмиссия». Клик открывает модалку
 *          glassmorphism (см. <MintModal/>).
 *        * Активность — пять последних строк Пульса Государства
 *          (транзакции, новые граждане, принятые указы).
 *
 * Авторизация: страница клиентская, guard — на `/api/admin/nexus`.
 * 403 → `/`, 401/«нет токена» → форма CLI-токена.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

interface ActivityEntryDto {
  id: string;
  event: string;
  category: string;
  titleKey: string;
  titleParams: Record<string, unknown>;
  actorId: string | null;
  nodeId: string | null;
  createdAt: string;
}

interface NexusDto {
  state: {
    id: string;
    slug: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    owner: {
      id: string;
      handle: string;
      displayName: string | null;
    } | null;
  };
  vertical: {
    totalNodes: number;
    totalCitizens: number;
    rootNodeId: string | null;
  };
  economy: {
    primaryAsset: PrimaryAssetDto | null;
    transactionTaxRate: number;
    currencyDisplayName: string | null;
    rootTreasuryWalletId: string | null;
  };
  activity: {
    entries: ActivityEntryDto[];
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
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mintOpen, setMintOpen] = useState(false);

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
      setLastLoadedAt(new Date());
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
      <NexusHeader
        state={data?.state ?? null}
        online={Boolean(data) && !error}
        syncing={loading}
        lastLoadedAt={lastLoadedAt}
        onRefresh={() => void reload()}
        onLogout={() => {
          window.localStorage.removeItem(TOKEN_STORAGE_KEY);
          setToken(null);
          setData(null);
          setLastLoadedAt(null);
        }}
      />

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
          <VerticalCard
            totalNodes={data.vertical.totalNodes}
            totalCitizens={data.vertical.totalCitizens}
          />
          <EconomyCard
            asset={data.economy.primaryAsset}
            transactionTaxRate={data.economy.transactionTaxRate}
            currencyDisplayName={data.economy.currencyDisplayName}
            rootTreasuryWalletId={data.economy.rootTreasuryWalletId}
            onMintClick={() => setMintOpen(true)}
          />
          <ActivityCard entries={data.activity.entries} />
          <GovernanceCard
            installed={data.governance.installed}
            proposals={data.governance.proposals}
          />
        </section>
      )}

      {mintOpen && data?.economy.primaryAsset && data.economy.rootTreasuryWalletId && (
        <MintModal
          token={token}
          asset={data.economy.primaryAsset}
          treasuryWalletId={data.economy.rootTreasuryWalletId}
          onClose={() => setMintOpen(false)}
          onSuccess={() => {
            setMintOpen(false);
            void reload();
          }}
        />
      )}
    </Shell>
  );
}

// ============================================================
// Header
// ============================================================

function NexusHeader({
  state,
  online,
  syncing,
  lastLoadedAt,
  onRefresh,
  onLogout,
}: {
  state: NexusDto["state"] | null;
  online: boolean;
  syncing: boolean;
  lastLoadedAt: Date | null;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const { t, formatTime } = useI18n();
  const stateName = state?.name ?? t("nexus.title");
  const handle = state?.owner?.displayName ?? state?.owner?.handle ?? null;

  const statusLabel = !online
    ? t("nexus.status.offline")
    : t("nexus.status.online");
  const syncLabel = syncing
    ? t("nexus.status.syncing")
    : t("nexus.status.synchronized");

  const lastSyncValue = lastLoadedAt ? formatTime(lastLoadedAt) : null;

  return (
    <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-primary">
          {t("nexus.eyebrow")}
        </p>
        <h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold">
          <span>{stateName}</span>
          {state?.slug && (
            <span className="rounded-full border border-primary/20 px-2 py-0.5 font-mono text-xs tracking-wider text-foreground/60">
              @{state.slug}
            </span>
          )}
        </h1>
        <p className="mt-2 flex flex-wrap items-center gap-3 text-xs uppercase tracking-widest text-foreground/50">
          <StatusDot online={online} syncing={syncing} />
          <span className={cn(online ? "text-emerald-400" : "text-destructive")}>
            {statusLabel}
          </span>
          <span className="text-foreground/30">·</span>
          <span className="text-foreground/60">{syncLabel}</span>
          {lastSyncValue && !syncing && (
            <>
              <span className="text-foreground/30">·</span>
              <span className="font-mono normal-case tracking-normal text-foreground/40">
                {t("nexus.status.lastSync", { value: lastSyncValue })}
              </span>
            </>
          )}
          {handle && (
            <>
              <span className="text-foreground/30">·</span>
              <span className="font-mono normal-case tracking-normal text-foreground/50">
                {handle}
              </span>
            </>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={syncing}
        >
          {syncing ? t("common.loadingDots") : t("common.refresh")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onLogout}>
          {t("common.logout")}
        </Button>
      </div>
    </header>
  );
}

/**
 * Пульсирующий статус-диод: зелёный, когда последний запрос успешен;
 * красный — если висит ошибка. Во время sync-а мы добавляем `animate-
 * ping` поверх, чтобы было видно, что рубка жива и не замерла.
 */
function StatusDot({ online, syncing }: { online: boolean; syncing: boolean }) {
  const colour = online ? "bg-emerald-400" : "bg-destructive";
  return (
    <span className="relative inline-flex h-2 w-2">
      {syncing && (
        <span
          aria-hidden
          className={cn(
            "absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping",
            colour,
          )}
        />
      )}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", colour)} />
    </span>
  );
}

// ============================================================
// Вертикаль
// ============================================================

function VerticalCard({
  totalNodes,
  totalCitizens,
}: {
  totalNodes: number;
  totalCitizens: number;
}) {
  const { t, tp } = useI18n();
  return (
    <NexusCard>
      <Eyebrow>{t("nexus.vertical.eyebrow")}</Eyebrow>
      <CardTitle className="mt-1">{t("nexus.vertical.title")}</CardTitle>
      <CardDescription>{t("nexus.vertical.desc")}</CardDescription>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <BigStat
          value={totalNodes}
          caption={t("nexus.vertical.nodesLabel")}
          subtitle={tp("nexus.vertical.nodes", totalNodes)}
        />
        <BigStat
          value={totalCitizens}
          caption={t("nexus.vertical.citizensLabel")}
          subtitle={tp("nexus.vertical.citizens", totalCitizens)}
        />
      </div>

      <div className="mt-auto flex flex-wrap gap-2 pt-5">
        <Link href="/admin/vertical-editor">
          <Button variant="crown" size="sm">
            {t("nexus.vertical.addNode")}
          </Button>
        </Link>
        <Link href="/admin/vertical-editor">
          <Button variant="outline" size="sm">
            {t("nexus.vertical.openTree")}
          </Button>
        </Link>
      </div>
    </NexusCard>
  );
}

// ============================================================
// Экономика
// ============================================================

function EconomyCard({
  asset,
  transactionTaxRate,
  currencyDisplayName,
  rootTreasuryWalletId,
  onMintClick,
}: {
  asset: PrimaryAssetDto | null;
  transactionTaxRate: number;
  currencyDisplayName: string | null;
  rootTreasuryWalletId: string | null;
  onMintClick: () => void;
}) {
  const { t, formatPercent, formatCompact } = useI18n();
  const displayName =
    currencyDisplayName ?? asset?.name ?? t("nexus.economy.noCurrency");
  const symbol = asset?.symbol ?? t("common.dash");
  const stateTaxPct = formatPercent(transactionTaxRate);
  const assetTaxPct = asset ? formatPercent(asset.taxRate) : t("common.dash");
  const supplyLabel = asset ? formatCompact(asset.totalSupply) : t("common.dash");

  const mintDisabledReason: string | null = !asset
    ? t("nexus.economy.mintDisabledNoAsset")
    : !asset.canMint
      ? t("nexus.economy.mintDisabledCantMint")
      : !rootTreasuryWalletId
        ? t("nexus.economy.mintDisabledNoTreasury")
        : null;

  return (
    <NexusCard id="nexus-economy-treasury">
      <Eyebrow>{t("nexus.economy.eyebrow")}</Eyebrow>
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

      <div className="mt-5">
        <BigStat
          value={supplyLabel}
          caption={t("nexus.economy.supply")}
          subtitle={asset ? symbol : undefined}
          mono
        />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
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
      </dl>

      <div className="mt-auto flex flex-wrap gap-2 pt-5">
        <Button
          variant="crown"
          size="sm"
          onClick={onMintClick}
          disabled={mintDisabledReason !== null}
          title={mintDisabledReason ?? undefined}
        >
          {t("nexus.economy.mint")}
        </Button>
        <Link href="/admin/economy">
          <Button variant="outline" size="sm">
            {t("nexus.economy.openFactory")}
          </Button>
        </Link>
        <Link href="/admin/constitution">
          <Button variant="ghost" size="sm">
            {t("nexus.economy.openConstitution")}
          </Button>
        </Link>
      </div>
    </NexusCard>
  );
}

// ============================================================
// Активность
// ============================================================

function ActivityCard({ entries }: { entries: ActivityEntryDto[] }) {
  const { t, formatDateTime } = useI18n();
  return (
    <NexusCard>
      <Eyebrow>{t("nexus.activity.eyebrow")}</Eyebrow>
      <CardTitle className="mt-1">{t("nexus.activity.title")}</CardTitle>
      <CardDescription>{t("nexus.activity.desc")}</CardDescription>

      {entries.length === 0 ? (
        <div className="mt-5 rounded-lg border border-primary/10 bg-card/40 p-4 text-sm text-foreground/60">
          {t("nexus.activity.empty")}
        </div>
      ) : (
        <ol className="mt-5 space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="group flex items-start gap-3 rounded-lg border border-primary/10 bg-card/40 p-3 transition-colors hover:border-primary/30"
            >
              <CategoryDot category={entry.category} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">
                  {t(entry.titleKey, entry.titleParams as Record<string, string | number>)}
                </p>
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-foreground/40">
                  {formatCategory(entry.category, t)} ·{" "}
                  {formatDateTime(entry.createdAt)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-auto flex flex-wrap gap-2 pt-5">
        <Link href="/">
          <Button variant="outline" size="sm">
            {t("nexus.activity.openFeed")}
          </Button>
        </Link>
      </div>
    </NexusCard>
  );
}

function formatCategory(
  category: string,
  t: ReturnType<typeof useI18n>["t"],
): string {
  const key = `nexus.activity.category.${category}`;
  const label = t(key);
  // Если у ленты прилетает экзотическая категория, `t()` вернёт сам
  // ключ — это наш сигнал упасть в общий «Событие».
  if (label === key) return t("nexus.activity.category.other");
  return label;
}

function CategoryDot({ category }: { category: string }) {
  const tone: Record<string, string> = {
    wallet: "bg-emerald-400",
    chat: "bg-sky-400",
    governance: "bg-primary",
    state: "bg-primary",
    exchange: "bg-fuchsia-400",
    kernel: "bg-foreground/50",
  };
  return (
    <span
      aria-hidden
      className={cn(
        "mt-1.5 h-2 w-2 shrink-0 rounded-full",
        tone[category] ?? "bg-foreground/40",
      )}
    />
  );
}

// ============================================================
// Законы (оставляем карточку из старого дашборда)
// ============================================================

function GovernanceCard({
  installed,
  proposals,
}: {
  installed: boolean;
  proposals: ProposalDto[];
}) {
  const { t, formatDate } = useI18n();
  return (
    <NexusCard>
      <Eyebrow>{t("nexus.governance.eyebrow")}</Eyebrow>
      <CardTitle className="mt-1">{t("nexus.governance.title")}</CardTitle>
      <CardDescription>{t("nexus.governance.desc")}</CardDescription>

      {!installed ? (
        <div className="mt-5 rounded-lg border border-primary/10 bg-card/40 p-4 text-sm text-foreground/60">
          {t("nexus.governance.notInstalled.before")}{" "}
          <code>governance</code>{" "}
          {t("nexus.governance.notInstalled.middle")}{" "}
          <code>krwn module install</code>
          {t("nexus.governance.notInstalled.after")}
        </div>
      ) : proposals.length === 0 ? (
        <div className="mt-5 rounded-lg border border-primary/10 bg-card/40 p-4 text-sm text-foreground/60">
          {t("nexus.governance.empty")}
        </div>
      ) : (
        <ul className="mt-5 space-y-2">
          {proposals.map((p) => (
            <li
              key={p.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-primary/10 bg-card/40 p-3"
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

      <div className="mt-auto flex flex-wrap gap-2 pt-5">
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
    </NexusCard>
  );
}

// ============================================================
// Mint Modal (glassmorphism)
// ============================================================

interface MintResponse {
  transaction?: { id: string; amount: number; currency: string };
  error?: string;
}

function MintModal({
  token,
  asset,
  treasuryWalletId,
  onClose,
  onSuccess,
}: {
  token: string;
  asset: PrimaryAssetDto;
  treasuryWalletId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t, formatNumber } = useI18n();
  const [amountText, setAmountText] = useState("");
  const [memo, setMemo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Esc закрывает модалку; блокируем прокрутку body, пока открыта.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const amount = useMemo(() => {
    const parsed = Number(amountText.replace(",", "."));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [amountText]);

  const submit = useCallback(
    async (ev: React.FormEvent) => {
      ev.preventDefault();
      if (amount === null) {
        setError(t("nexus.mint.errorAmount"));
        return;
      }
      setSubmitting(true);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch("/api/wallet/mint", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            toWalletId: treasuryWalletId,
            amount,
            currency: asset.symbol,
            memo: memo.trim() || undefined,
          }),
        });
        const payload = (await res.json()) as MintResponse;
        if (!res.ok) {
          throw new Error(payload.error ?? `HTTP ${res.status}`);
        }
        setNotice(
          t("nexus.mint.success", {
            amount: formatNumber(amount),
            symbol: asset.symbol,
          }),
        );
        setTimeout(onSuccess, 600);
      } catch (err) {
        setError(
          t("nexus.mint.errorGeneric", {
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      } finally {
        setSubmitting(false);
      }
    },
    [amount, token, treasuryWalletId, asset.symbol, memo, onSuccess, t, formatNumber],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("nexus.mint.title", { symbol: asset.symbol })}
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      {/* Glassmorphism backdrop: затемнение + размытие заднего плана. */}
      <button
        type="button"
        aria-label={t("common.close")}
        onClick={onClose}
        className="absolute inset-0 bg-background/70 backdrop-blur-md"
      />

      <form
        onSubmit={submit}
        className={cn(
          "relative w-full max-w-md rounded-2xl border border-primary/25 bg-card/70 p-6",
          "shadow-[0_0_48px_-12px_rgba(212,175,55,0.45)] backdrop-blur-xl",
        )}
      >
        <Eyebrow>{t("nexus.economy.eyebrow")}</Eyebrow>
        <CardTitle className="mt-1">
          {t("nexus.mint.title", { symbol: asset.symbol })}
        </CardTitle>
        <CardDescription>
          {t("nexus.mint.desc", { kind: "mint" })}
        </CardDescription>

        <div className="mt-5 grid gap-4 text-sm">
          <Stat
            label={t("nexus.mint.target")}
            value={t("nexus.mint.targetTreasury")}
            hint={treasuryWalletId}
          />

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-foreground/50">
              {t("nexus.mint.amount")}
            </span>
            <Input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              autoFocus
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-foreground/50">
              {t("nexus.mint.memo")}
            </span>
            <Input
              type="text"
              placeholder={t("nexus.mint.memoPlaceholder")}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              maxLength={280}
            />
          </label>
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
            {error}
          </div>
        )}
        {notice && (
          <div className="mt-4 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2 text-xs text-emerald-400">
            {notice}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={submitting}
          >
            {t("nexus.mint.cancel")}
          </Button>
          <Button
            type="submit"
            variant="crown"
            size="sm"
            disabled={submitting || amount === null}
          >
            {submitting ? t("common.sending") : t("nexus.mint.confirm")}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ============================================================
// Building blocks
// ============================================================

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12">
      {children}
    </main>
  );
}

/**
 * Переиспользуемая «стерильная» карточка Nexus: антрацитовый фон с
 * тонким блюром и золотая волосяная граница (`border-primary/20`).
 * Поверх неё мы ставим каждую сущность дашборда — Вертикаль,
 * Экономику, Активность, Законы.
 */
function NexusCard({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <Card
      id={id}
      className={cn(
        "flex flex-col border-primary/20 bg-card/60 backdrop-blur-sm",
        "transition-colors hover:border-primary/40",
        className,
      )}
    >
      {children}
    </Card>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-[0.3em] text-foreground/50">
      {children}
    </p>
  );
}

function BigStat({
  value,
  caption,
  subtitle,
  mono,
}: {
  value: number | string;
  caption: string;
  subtitle?: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-primary/15 bg-background/60 p-4">
      <p className="text-[10px] uppercase tracking-widest text-foreground/50">
        {caption}
      </p>
      <p
        className={cn(
          "mt-1 text-3xl font-semibold text-primary",
          mono && "font-mono",
        )}
      >
        {value}
      </p>
      {subtitle && (
        <p className="mt-1 text-xs text-foreground/50">{subtitle}</p>
      )}
    </div>
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
        "rounded-lg border border-primary/10 bg-background/40 p-3",
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
        <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-widest text-foreground/40">
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
    open: "border-primary/50 text-primary",
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
    <Card className="mx-auto mt-24 max-w-md border-primary/20 bg-card/60 backdrop-blur-sm">
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
