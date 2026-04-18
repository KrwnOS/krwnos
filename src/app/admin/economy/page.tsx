/**
 * `/admin/economy` — Currency Factory UI (Фабрика Валют).
 * ------------------------------------------------------------
 * This is the Sovereign's dashboard for monetary policy. From
 * here they can:
 *
 *   1. See every registered `StateAsset` of their State.
 *   2. Create a new asset (DurovCoin, Empire Gold, USD, …) —
 *      picking the type (INTERNAL / ON_CHAIN), mode (LOCAL /
 *      EXTERNAL / HYBRID), `canMint` (Эмиссия), `taxRate`
 *      (Налог штата) and `publicSupply` (Публичность).
 *   3. Tweak those knobs on any existing asset.
 *   4. Press "Установить государственную валюту" on any asset
 *      to promote it to the national currency — clearing the
 *      `isPrimary` flag on every sibling atomically.
 *
 * Transport: the page is a client component that speaks to the
 * existing `/api/wallet/assets` + `/api/wallet/supply/:id`
 * endpoints with a Bearer token pulled from
 * `localStorage["krwn.token"]` (same scheme the chat widget
 * uses). No server actions — keeps the file a single self-
 * contained blob and avoids leaking the CLI token into RSC.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------
// Wire types (mirror the API responses).
// ------------------------------------------------------------

type AssetType = "INTERNAL" | "ON_CHAIN";
type AssetMode = "LOCAL" | "EXTERNAL" | "HYBRID";

interface StateAssetDto {
  id: string;
  stateId: string;
  symbol: string;
  name: string;
  type: AssetType;
  mode: AssetMode;
  contractAddress: string | null;
  network: string | null;
  chainId: number | null;
  decimals: number;
  exchangeRate: number | null;
  icon: string | null;
  color: string | null;
  isPrimary: boolean;
  canMint: boolean;
  taxRate: number;
  publicSupply: boolean;
}

const TOKEN_STORAGE_KEY = "krwn.token";

// ------------------------------------------------------------

export default function AdminEconomyPage() {
  const [token, setToken] = useState<string | null>(null);
  const [assets, setAssets] = useState<StateAssetDto[] | null>(null);
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
      const res = await fetch("/api/wallet/assets", {
        headers: { authorization: `Bearer ${token}` },
      });
      const payload = (await res.json()) as
        | { assets: StateAssetDto[] }
        | { error: string };
      if (!res.ok) {
        throw new Error(
          "error" in payload ? payload.error : `HTTP ${res.status}`,
        );
      }
      setAssets("assets" in payload ? payload.assets : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
      setAssets(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const primary = useMemo(
    () => assets?.find((a) => a.isPrimary) ?? null,
    [assets],
  );

  if (!token) {
    return (
      <AdminShell>
        <TokenPrompt
          onSubmit={(next) => {
            window.localStorage.setItem(TOKEN_STORAGE_KEY, next);
            setToken(next);
          }}
        />
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-crown">
            Фабрика Валют
          </p>
          <h1 className="mt-1 text-3xl font-semibold">Экономика государства</h1>
          <p className="mt-2 max-w-2xl text-sm text-foreground/60">
            Определите национальную валюту, настройте эмиссию, налог штата и
            публичность. Ровно один актив государства может быть помечен как
            «флаг» — его и увидят граждане по умолчанию.
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
              setAssets(null);
            }}
          >
            Сменить токен
          </Button>
        </div>
      </header>

      {error && (
        <Card className="mb-6 border-destructive/40 bg-destructive/5 text-sm text-destructive">
          Ошибка: {error}. Проверьте, что токен выдан с правом{" "}
          <code>wallet.manage_assets</code> или вы — Суверен.
        </Card>
      )}

      {primary && (
        <Card className="mb-6 border-crown/50 bg-crown/5">
          <div className="flex items-center gap-3">
            <span className="text-3xl" style={{ color: primary.color ?? undefined }}>
              {primary.icon ?? "⚜"}
            </span>
            <div>
              <CardTitle>
                Текущая валюта: {primary.name}{" "}
                <span className="text-foreground/50">({primary.symbol})</span>
              </CardTitle>
              <CardDescription>
                {prettyMode(primary)} · {primary.decimals} decimals ·{" "}
                {primary.canMint ? "эмиссия открыта" : "эмиссия заморожена"} ·
                налог {formatPercent(primary.taxRate)} ·
                {primary.publicSupply
                  ? " объём публичен"
                  : " объём скрыт"}
              </CardDescription>
            </div>
          </div>
        </Card>
      )}

      <section className="grid gap-4">
        {assets?.length === 0 && (
          <Card className="text-sm text-foreground/60">
            Валюты ещё не зарегистрированы. Создайте первую ниже.
          </Card>
        )}
        {assets?.map((asset) => (
          <AssetRow
            key={asset.id}
            asset={asset}
            token={token}
            onChanged={reload}
          />
        ))}
      </section>

      <section className="mt-12">
        <h2 className="mb-3 text-sm uppercase tracking-widest text-foreground/50">
          Новая валюта
        </h2>
        <CreateAssetForm token={token} onCreated={reload} />
      </section>
    </AdminShell>
  );
}

// ------------------------------------------------------------
// Sub-components
// ------------------------------------------------------------

function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12">
      {children}
    </main>
  );
}

function TokenPrompt({ onSubmit }: { onSubmit: (token: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <Card className="mx-auto mt-24 max-w-md">
      <CardTitle>Вход в экономический контур</CardTitle>
      <CardDescription>
        Для управления валютами нужен CLI-токен Суверена (или лицо с правом{" "}
        <code>wallet.manage_assets</code>). Сгенерируйте его командой{" "}
        <code>krwn token mint</code>.
      </CardDescription>
      <form
        className="mt-4 flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <Input
          placeholder="krwn_live_…"
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

function AssetRow({
  asset,
  token,
  onChanged,
}: {
  asset: StateAssetDto;
  token: string;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local edit state for the three Currency Factory knobs. We
  // commit via PATCH only when the user presses "Сохранить".
  const [canMint, setCanMint] = useState(asset.canMint);
  const [taxPct, setTaxPct] = useState((asset.taxRate * 100).toString());
  const [publicSupply, setPublicSupply] = useState(asset.publicSupply);

  useEffect(() => {
    setCanMint(asset.canMint);
    setTaxPct((asset.taxRate * 100).toString());
    setPublicSupply(asset.publicSupply);
  }, [asset.canMint, asset.taxRate, asset.publicSupply]);

  const dirty =
    canMint !== asset.canMint ||
    publicSupply !== asset.publicSupply ||
    Number(taxPct) / 100 !== asset.taxRate;

  const canMintEditable =
    !(asset.type === "ON_CHAIN" && asset.mode === "EXTERNAL");
  const taxEditable = asset.type !== "ON_CHAIN";

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const rate = Number(taxPct) / 100;
      if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
        throw new Error("Налог должен быть в диапазоне 0..100%.");
      }
      const res = await fetch(`/api/wallet/assets/${asset.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          canMint,
          taxRate: rate,
          publicSupply,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ошибка");
    } finally {
      setBusy(false);
    }
  };

  const promote = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/wallet/assets/${asset.id}/primary`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ошибка");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      className={cn(
        "transition-colors",
        asset.isPrimary && "border-crown/60 bg-crown/5",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className="text-2xl"
            style={{ color: asset.color ?? undefined }}
            aria-hidden
          >
            {asset.icon ?? "◈"}
          </span>
          <div>
            <CardTitle>
              {asset.name}{" "}
              <span className="text-sm font-normal text-foreground/50">
                ({asset.symbol})
              </span>
              {asset.isPrimary && (
                <span className="ml-2 rounded-full border border-crown/40 px-2 py-0.5 text-[10px] uppercase tracking-widest text-crown">
                  Флаг государства
                </span>
              )}
            </CardTitle>
            <CardDescription>
              {prettyMode(asset)} · {asset.decimals} decimals
              {asset.contractAddress && (
                <>
                  {" · "}
                  <code className="text-xs">{shortenAddr(asset.contractAddress)}</code>
                </>
              )}
            </CardDescription>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="crown"
            size="sm"
            disabled={asset.isPrimary || busy}
            onClick={() => void promote()}
            title={
              asset.isPrimary
                ? "Этот актив уже является валютой государства"
                : undefined
            }
          >
            {asset.isPrimary
              ? "Текущая валюта"
              : "Установить государственную валюту"}
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <ToggleField
          label="Эмиссия"
          hint="Разрешено ли печатать новые деньги (mint)."
          checked={canMint}
          onChange={setCanMint}
          disabled={!canMintEditable || busy}
          disabledReason={
            !canMintEditable
              ? "Вне-чейн актив: контракт не под нашим контролем."
              : undefined
          }
        />
        <div>
          <label className="text-xs font-semibold uppercase tracking-widest text-foreground/60">
            Налог штата (%)
          </label>
          <Input
            type="number"
            step="0.1"
            min={0}
            max={100}
            value={taxPct}
            onChange={(e) => setTaxPct(e.target.value)}
            disabled={!taxEditable || busy}
            className="mt-2"
          />
          <p className="mt-1 text-xs text-foreground/50">
            {taxEditable
              ? "Процент, автоматически удерживаемый в Казну с каждого перевода."
              : "Для ON_CHAIN активов налог не применяется."}
          </p>
        </div>
        <ToggleField
          label="Публичность"
          hint="Виден ли общий объём валюты гражданам (и внешним аудиторам)."
          checked={publicSupply}
          onChange={setPublicSupply}
          disabled={busy}
        />
      </div>

      {error && (
        <p className="mt-4 text-sm text-destructive">Ошибка: {error}</p>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!dirty || busy}
          onClick={() => void save()}
        >
          {busy ? "Сохраняю…" : "Сохранить"}
        </Button>
      </div>
    </Card>
  );
}

function ToggleField({
  label,
  hint,
  checked,
  onChange,
  disabled,
  disabledReason,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <div>
      <label className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-widest text-foreground/60">
        {label}
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={disabled}
          onClick={() => onChange(!checked)}
          className={cn(
            "relative inline-flex h-5 w-9 items-center rounded-full border transition-colors",
            checked
              ? "border-crown/60 bg-crown/40"
              : "border-border bg-background",
            disabled && "opacity-50",
          )}
        >
          <span
            className={cn(
              "inline-block h-3.5 w-3.5 rounded-full bg-foreground transition-transform",
              checked ? "translate-x-5" : "translate-x-1",
            )}
          />
        </button>
      </label>
      <p className="mt-1 text-xs text-foreground/50">
        {disabled && disabledReason ? disabledReason : hint}
      </p>
    </div>
  );
}

function CreateAssetForm({
  token,
  onCreated,
}: {
  token: string;
  onCreated: () => void | Promise<void>;
}) {
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<AssetType>("INTERNAL");
  const [mode, setMode] = useState<AssetMode>("LOCAL");
  const [contractAddress, setContractAddress] = useState("");
  const [network, setNetwork] = useState("");
  const [canMint, setCanMint] = useState(true);
  const [taxPct, setTaxPct] = useState("0");
  const [publicSupply, setPublicSupply] = useState(false);
  const [isPrimary, setIsPrimary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Default the mode to match the type. The server validates
    // this anyway; we only do it here to avoid UX friction.
    setMode(type === "INTERNAL" ? "LOCAL" : "EXTERNAL");
  }, [type]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const rate = Number(taxPct) / 100;
      const body: Record<string, unknown> = {
        symbol,
        name,
        type,
        mode,
        canMint,
        taxRate: rate,
        publicSupply,
        isPrimary,
      };
      if (mode !== "LOCAL") {
        body.contractAddress = contractAddress;
        body.network = network;
      }
      const res = await fetch("/api/wallet/assets", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: unknown;
        };
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : JSON.stringify(payload.error ?? `HTTP ${res.status}`),
        );
      }
      setSymbol("");
      setName("");
      setContractAddress("");
      setNetwork("");
      setTaxPct("0");
      setIsPrimary(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ошибка");
    } finally {
      setBusy(false);
    }
  };

  const onChain = mode !== "LOCAL";

  return (
    <Card>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <Field label="Название валюты">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="DurovCoin, Empire Gold, USD…"
            required
          />
        </Field>
        <Field label="Тикер (symbol)">
          <Input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="KRN"
            maxLength={16}
            required
          />
        </Field>
        <Field label="Тип">
          <select
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value as AssetType)}
          >
            <option value="INTERNAL">INTERNAL — виртуальная</option>
            <option value="ON_CHAIN">ON_CHAIN — токен в блокчейне</option>
          </select>
        </Field>
        <Field label="Режим учёта">
          <select
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
            value={mode}
            onChange={(e) => setMode(e.target.value as AssetMode)}
          >
            {type === "INTERNAL" && (
              <>
                <option value="LOCAL">LOCAL — только леджер</option>
                <option value="HYBRID">HYBRID — леджер + withdraw</option>
              </>
            )}
            {type === "ON_CHAIN" && (
              <>
                <option value="EXTERNAL">EXTERNAL — чистый on-chain</option>
                <option value="HYBRID">HYBRID — с мгновенным учётом</option>
              </>
            )}
          </select>
        </Field>
        {onChain && (
          <>
            <Field label="Сеть">
              <Input
                value={network}
                onChange={(e) => setNetwork(e.target.value)}
                placeholder="ethereum, polygon, solana…"
                required
              />
            </Field>
            <Field label="Адрес контракта">
              <Input
                value={contractAddress}
                onChange={(e) => setContractAddress(e.target.value)}
                placeholder="0x…"
                required
              />
            </Field>
          </>
        )}
        <Field label="Налог штата (%)">
          <Input
            type="number"
            step="0.1"
            min={0}
            max={100}
            value={taxPct}
            onChange={(e) => setTaxPct(e.target.value)}
            disabled={type === "ON_CHAIN"}
          />
        </Field>
        <div className="flex flex-col justify-end gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={canMint}
              onChange={(e) => setCanMint(e.target.checked)}
              disabled={type === "ON_CHAIN" && mode === "EXTERNAL"}
            />
            Эмиссия разрешена
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={publicSupply}
              onChange={(e) => setPublicSupply(e.target.checked)}
            />
            Публичный объём
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
            />
            Сразу сделать национальной валютой
          </label>
        </div>
        {error && (
          <p className="sm:col-span-2 text-sm text-destructive">
            Ошибка: {error}
          </p>
        )}
        <div className="sm:col-span-2 flex justify-end">
          <Button type="submit" variant="crown" disabled={busy}>
            {busy ? "Создаю…" : "Зарегистрировать валюту"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-widest text-foreground/60">
      {label}
      <span className="block text-[0px]">{/* spacer */}</span>
      <span className="block normal-case tracking-normal">{children}</span>
    </label>
  );
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function prettyMode(asset: StateAssetDto): string {
  const bits: string[] = [asset.type, asset.mode];
  if (asset.network) bits.push(asset.network);
  return bits.join(" · ");
}

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(fraction === 0 ? 0 : 2)}%`;
}

function shortenAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
