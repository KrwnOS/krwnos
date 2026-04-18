"use client";

/**
 * TransferForm — Krona transfer form for the wallet module.
 * ------------------------------------------------------------
 * Collects:
 *   * Source  — caller's personal wallet or, if available, any
 *               department / node treasury the caller may spend
 *               from (passed in via `treasuries`).
 *   * Target  — userId / nodeId / walletId.
 *   * Amount  — positive float, validated against source balance.
 *   * Memo    — optional short comment (<= 280 chars).
 *
 * Submits a POST to `/api/wallet/transfer` (see the route for the
 * exact body schema). The component is form-only — if you need a
 * modal wrapper, compose it in the parent.
 */

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import {
  formatAmount,
  parseAmountInput,
  type WalletDto,
} from "@/components/wallet";

export interface TransferFormTreasury {
  wallet: WalletDto;
  /** Human-readable label, e.g. "Казна · Минфин". */
  label: string;
}

export interface TransferFormProps {
  /** Caller's personal wallet (required for PERSONAL source). */
  personal: WalletDto;
  /** Treasuries the caller is allowed to spend from. */
  treasuries?: TransferFormTreasury[];
  /** Bearer token used for the POST. */
  authToken: string;

  /** Default source when the form mounts. */
  defaultSource?: SourceChoice;

  onSuccess?: () => void;
  onCancel?: () => void;
  className?: string;
}

export type SourceChoice =
  | { kind: "personal" }
  | { kind: "treasury"; nodeId: string };

type DestinationKind = "user" | "treasury" | "walletId";

export function TransferForm({
  personal,
  treasuries = [],
  authToken,
  defaultSource,
  onSuccess,
  onCancel,
  className,
}: TransferFormProps): React.ReactElement {
  const t = useT();
  const [source, setSource] = React.useState<SourceChoice>(
    defaultSource ?? { kind: "personal" },
  );
  const [destKind, setDestKind] = React.useState<DestinationKind>("user");
  const [destValue, setDestValue] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [memo, setMemo] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const sourceWallet: WalletDto =
    source.kind === "personal"
      ? personal
      : treasuries.find((t) => t.wallet.nodeId === source.nodeId)?.wallet ??
        personal;

  const parsed = parseAmountInput(amount);
  const amountValid = parsed !== null && parsed > 0;
  const enoughFunds = amountValid && sourceWallet.balance >= (parsed ?? 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!amountValid) {
      setError(t("wallet.err.amount"));
      return;
    }
    if (!enoughFunds) {
      setError(t("wallet.err.insufficient"));
      return;
    }
    if (destValue.trim().length === 0) {
      setError(t("wallet.err.noRecipient"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/wallet/transfer", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          from: source,
          to: buildDestination(destKind, destValue),
          amount: parsed ?? 0,
          currency: sourceWallet.currency,
          memo: memo.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(
          payload.error ?? t("wallet.err.serverStatus", { status: res.status }),
        );
        return;
      }

      setAmount("");
      setMemo("");
      setDestValue("");
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card
      className={cn("w-full max-w-md space-y-5", className)}
      role="region"
      aria-label={t("wallet.transferTitle")}
    >
      <header>
        <h2 className="text-lg font-semibold text-foreground">
          {t("wallet.transferTitle")}
        </h2>
        <p className="mt-1 text-xs text-foreground/50">
          {t("wallet.transferDesc")}
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-5">
        <fieldset>
          <legend className="text-xs uppercase tracking-widest text-foreground/50">
            {t("wallet.source")}
          </legend>
          <div className="mt-2 space-y-2">
            <SourceOption
              selected={source.kind === "personal"}
              onSelect={() => setSource({ kind: "personal" })}
              title={t("wallet.source.personal")}
              subtitle={t("wallet.source.balance", {
                amount: formatAmount(personal.balance, {
                  currency: personal.currency,
                }),
              })}
            />
            {treasuries.length > 0 ? (
              treasuries.map((tr) => (
                <SourceOption
                  key={tr.wallet.id}
                  selected={
                    source.kind === "treasury" &&
                    source.nodeId === tr.wallet.nodeId
                  }
                  onSelect={() =>
                    setSource({
                      kind: "treasury",
                      nodeId: tr.wallet.nodeId ?? "",
                    })
                  }
                  title={tr.label}
                  subtitle={t("wallet.source.budget", {
                    amount: formatAmount(tr.wallet.balance, {
                      currency: tr.wallet.currency,
                    }),
                  })}
                  accent
                />
              ))
            ) : (
              <p className="text-xs text-foreground/40">
                {t("wallet.source.noTreasuries.prefix")}
                <code className="ml-1 rounded bg-foreground/10 px-1 py-0.5 font-mono text-[10px]">
                  wallet.view_treasury
                </code>
                {t("wallet.source.noTreasuries.suffix")}
              </p>
            )}
          </div>
        </fieldset>

        <div>
          <label className="block text-xs uppercase tracking-widest text-foreground/50">
            {t("wallet.recipient")}
          </label>
          <div className="mt-2 flex gap-2">
            <select
              value={destKind}
              onChange={(e) => setDestKind(e.target.value as DestinationKind)}
              className="h-10 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            >
              <option value="user">{t("wallet.recipient.user")}</option>
              <option value="treasury">{t("wallet.recipient.treasury")}</option>
              <option value="walletId">{t("wallet.recipient.walletId")}</option>
            </select>
            <Input
              value={destValue}
              onChange={(e) => setDestValue(e.target.value)}
              placeholder={placeholderFor(destKind)}
              className="flex-1 font-mono"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-widest text-foreground/50">
            {t("wallet.amount")}
          </label>
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className={cn(
              "mt-2 text-right font-mono text-lg tabular-nums",
              !amountValid && amount.length > 0 && "border-rose-500/60",
            )}
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-widest text-foreground/50">
            {t("wallet.memo")}
          </label>
          <Input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            maxLength={280}
            placeholder={t("wallet.memoPh")}
            className="mt-2"
          />
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
          >
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-2">
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
          ) : null}
          <Button
            type="submit"
            variant="crown"
            disabled={submitting || !amountValid || !enoughFunds}
          >
            {submitting ? t("common.sending") : t("common.confirm")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function SourceOption({
  selected,
  onSelect,
  title,
  subtitle,
  accent,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  subtitle: string;
  accent?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors",
        selected
          ? accent
            ? "border-crown bg-crown/10"
            : "border-foreground/60 bg-foreground/5"
          : "border-border bg-background/40 hover:bg-foreground/5",
      )}
      aria-pressed={selected}
    >
      <div>
        <p className={cn("text-sm font-medium", accent && "text-crown")}>
          {title}
        </p>
        <p className="text-xs text-foreground/50">{subtitle}</p>
      </div>
      <span
        aria-hidden
        className={cn(
          "h-3 w-3 rounded-full border",
          selected
            ? accent
              ? "border-crown bg-crown"
              : "border-foreground bg-foreground"
            : "border-border",
        )}
      />
    </button>
  );
}

function placeholderFor(k: DestinationKind): string {
  switch (k) {
    case "user":
      return "userId (cuid)";
    case "treasury":
      return "nodeId (cuid)";
    case "walletId":
      return "walletId (cuid)";
  }
}

function buildDestination(kind: DestinationKind, value: string) {
  const trimmed = value.trim();
  switch (kind) {
    case "user":
      return { kind: "user" as const, userId: trimmed };
    case "treasury":
      return { kind: "treasury" as const, nodeId: trimmed };
    case "walletId":
      return { kind: "walletId" as const, walletId: trimmed };
  }
}
