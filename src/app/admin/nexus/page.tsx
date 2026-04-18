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
 * Как будет развиваться:
 *   * Каждый установленный модуль («Модуль торговли», «Модуль
 *     безопасности», …) сможет контрибьютить `ModuleWidget` через
 *     Registry. Nexus будет дополнительно рендерить их рядом с
 *     тремя «коренными» карточками.
 *   * Владелец сможет перетаскивать карточки и сохранять layout.
 *   * Сейчас всё, что может потребовать плагин — это вернуть из
 *     `module.getWidget()` компонент; мы специально оставили слот
 *     `{/* Future: module widgets */}` в сетке ниже.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------
// Wire types (mirror /api/admin/nexus)
// ------------------------------------------------------------

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

// Куда уходит гражданин, если он попытался открыть Nexus без прав.
// Общая лента событий пока не выделена в отдельный роут — используем
// корень приложения, там живёт чат и общая витрина.
const CITIZEN_FEED_PATH = "/";

// ------------------------------------------------------------

export default function AdminNexusPage() {
  const router = useRouter();
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
        // Не Суверен и нет system.admin — это обычный гражданин.
        // Отправляем его на общую ленту событий, как требует guard.
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
            Nexus
          </p>
          <h1 className="mt-1 text-3xl font-semibold">
            Главная Суверена
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-foreground/60">
            Рубка управления государством. Отсюда видно состояние
            Вертикали, монетарной политики и Палаты Законов. Позже
            каждый установленный модуль сможет принести сюда свою
            карточку — Nexus станет настраиваемым рабочим столом.
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
              setData(null);
            }}
          >
            Сменить токен
          </Button>
        </div>
      </header>

      {error && (
        <Card className="mb-6 border-destructive/40 bg-destructive/5 text-sm text-destructive">
          Ошибка: {error}. Проверьте, что токен выдан Суверену либо
          держателю глобального права <code>system.admin</code>.
        </Card>
      )}

      {!data && !error && (
        <Card className="text-sm text-foreground/60">
          Загружаем состояние государства…
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
          {/* Future: module widgets will be rendered here. Каждый
              плагин вернёт `ModuleWidget` через Registry, а Nexus
              поместит его в эту же сетку рядом с тремя
              «коренными» карточками. */}
        </section>
      )}
    </Shell>
  );
}

// ------------------------------------------------------------
// Cards
// ------------------------------------------------------------

function VerticalCard({ totalNodes }: { totalNodes: number }) {
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <p className="text-[10px] uppercase tracking-[0.3em] text-foreground/50">
          Вертикаль
        </p>
        <CardTitle className="mt-1">Дерево власти</CardTitle>
        <CardDescription>
          Узлы, должности и ранги — графовая структура, по которой
          распределяются права.
        </CardDescription>
      </div>

      <div className="flex items-end gap-2">
        <span className="text-4xl font-semibold text-crown">
          {totalNodes}
        </span>
        <span className="pb-1 text-sm text-foreground/60">
          {pluralise(totalNodes, ["узел", "узла", "узлов"])}
        </span>
      </div>

      <div className="mt-auto flex flex-wrap gap-2">
        <Link href="/admin/vertical">
          <Button variant="crown" size="sm">
            Добавить узел
          </Button>
        </Link>
        <Link href="/admin/vertical">
          <Button variant="outline" size="sm">
            Открыть дерево
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
  const displayName =
    currencyDisplayName ?? asset?.name ?? "Валюта не определена";
  const symbol = asset?.symbol ?? "—";
  // taxRate в системе хранится как фракция [0..1]. Палата Указов
  // задаёт государственный налог на перевод (transactionTaxRate),
  // Фабрика Валют — ставку конкретного актива. Показываем обе.
  const stateTaxPct = formatPercent(transactionTaxRate);
  const assetTaxPct = asset ? formatPercent(asset.taxRate) : "—";

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <p className="text-[10px] uppercase tracking-[0.3em] text-foreground/50">
          Экономика
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
        <CardDescription>
          Монетарная политика государства: ставки налога и объём
          циркулирующей валюты.
        </CardDescription>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Stat label="Налог (штат)" value={stateTaxPct} hint="Палата Указов" />
        <Stat label="Налог (актив)" value={assetTaxPct} hint="Фабрика Валют" />
        <Stat
          label="Объём в системе"
          value={asset ? formatAmount(asset.totalSupply) : "—"}
          hint={asset ? symbol : undefined}
          span={2}
        />
      </dl>

      <div className="mt-auto flex flex-wrap gap-2">
        <Link href="/admin/economy">
          <Button variant="crown" size="sm">
            Настройки валюты
          </Button>
        </Link>
        <Link href="/admin/constitution">
          <Button variant="outline" size="sm">
            Палата Указов
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
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <p className="text-[10px] uppercase tracking-[0.3em] text-foreground/50">
          Законы
        </p>
        <CardTitle className="mt-1">Последние предложения</CardTitle>
        <CardDescription>
          Три последних Proposal из модуля Governance с текущим
          статусом рассмотрения.
        </CardDescription>
      </div>

      {!installed ? (
        <div className="rounded-lg border border-border/60 bg-background/40 p-4 text-sm text-foreground/60">
          Модуль <code>governance</code> ещё не установлен. Когда
          Суверен подключит его через <code>krwn module install</code>,
          здесь появится лента предложений.
        </div>
      ) : proposals.length === 0 ? (
        <div className="rounded-lg border border-border/60 bg-background/40 p-4 text-sm text-foreground/60">
          Палата Законов пока пуста — ни одного предложения не внесено.
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
            title={
              installed
                ? undefined
                : "Установите модуль governance, чтобы открыть Палату Законов."
            }
          >
            Палата Законов
          </Button>
        </Link>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------
// Tiny presentational helpers
// ------------------------------------------------------------

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
  const map: Record<ProposalStatus, { label: string; tone: string }> = {
    draft: { label: "черновик", tone: "border-border text-foreground/60" },
    open: { label: "открыто", tone: "border-crown/60 text-crown" },
    passed: {
      label: "принят",
      tone: "border-emerald-500/50 text-emerald-400",
    },
    rejected: {
      label: "отклонён",
      tone: "border-destructive/50 text-destructive",
    },
    executed: {
      label: "исполнен",
      tone: "border-emerald-500/50 text-emerald-400",
    },
    expired: {
      label: "истёк",
      tone: "border-border text-foreground/40",
    },
  };
  const { label, tone } = map[status] ?? map.draft;
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest",
        tone,
      )}
    >
      {label}
    </span>
  );
}

function TokenPrompt({ onSubmit }: { onSubmit: (token: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <Card className="mx-auto mt-24 max-w-md">
      <CardTitle>Вход в Nexus</CardTitle>
      <CardDescription>
        Nexus открыт только Суверену государства или держателю
        глобального права <code>system.admin</code>. Используйте
        CLI-токен, выданный командой <code>krwn token mint</code>.
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

// ------------------------------------------------------------
// Formatters
// ------------------------------------------------------------

function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return "—";
  const pct = fraction * 100;
  const precision = pct === 0 || pct >= 10 ? 0 : 2;
  return `${pct.toFixed(precision)}%`;
}

function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

function pluralise(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const n1 = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
}
