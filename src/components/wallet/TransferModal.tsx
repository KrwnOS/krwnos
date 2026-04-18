"use client";

/**
 * TransferModal — Krona transfer form.
 * ------------------------------------------------------------
 * Two fundable sources:
 *   * Personal — the caller's own wallet.
 *   * Treasury — any node treasury the caller may spend from
 *                (the parent passes these in via `treasuries`).
 *
 * Destination:
 *   * Citizen handle / userId, OR
 *   * Another treasury (for budget reallocation by the Sovereign).
 *
 * On success the modal POSTs to `/api/wallet/transfer` with the
 * bearer CLI token the caller's already holding. The parent owns
 * the token and passes it as `authToken`.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { formatAmount, parseAmountInput } from "./format";
import type { WalletDto } from "./types";

export interface TransferModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;

  /** Caller's personal wallet (required). */
  personal: WalletDto;
  /** Treasuries the caller is allowed to spend from. Empty array = hide. */
  treasuries?: Array<{ wallet: WalletDto; label: string }>;
  /** Bearer token used for the POST. */
  authToken: string;

  /** Default source — handy when opened from a treasury card. */
  defaultSource?:
    | { kind: "personal" }
    | { kind: "treasury"; nodeId: string };
}

type SourceChoice =
  | { kind: "personal" }
  | { kind: "treasury"; nodeId: string };

type DestinationKind = "user" | "treasury" | "walletId";

export function TransferModal(props: TransferModalProps): React.ReactElement | null {
  const { open, onClose, onSuccess, personal, treasuries = [], authToken } = props;
  const t = useT();

  const [source, setSource] = React.useState<SourceChoice>(
    props.defaultSource ?? { kind: "personal" },
  );
  const [destKind, setDestKind] = React.useState<DestinationKind>("user");
  const [destValue, setDestValue] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [memo, setMemo] = React.useState("");

  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const sourceWallet: WalletDto =
    source.kind === "personal"
      ? personal
      : treasuries.find((t) => t.wallet.nodeId === source.nodeId)?.wallet ??
        personal;

  const parsedAmount = parseAmountInput(amount);
  const amountValid = parsedAmount !== null && parsedAmount > 0;
  const enoughFunds =
    amountValid && sourceWallet.balance >= (parsedAmount ?? 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!amountValid) {
      setError(t("wallet.err.amountModal"));
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
          amount: parsedAmount ?? 0,
          currency: sourceWallet.currency,
          memo: memo.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
        };
        setError(
          payload.error ?? t("wallet.err.serverStatus", { status: res.status }),
        );
        return;
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            {t("wallet.transferTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-foreground/40 hover:text-foreground"
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>

        {treasuries.length > 0 ? (
          <fieldset className="mt-4">
            <legend className="text-xs uppercase tracking-widest text-foreground/50">
              {t("wallet.source")}
            </legend>
            <div className="mt-2 space-y-2">
              <SourceOption
                selected={source.kind === "personal"}
                onSelect={() => setSource({ kind: "personal" })}
                title={t("wallet.source.personalModal")}
                subtitle={t("wallet.source.balance", {
                  amount: formatAmount(personal.balance, {
                    currency: personal.currency,
                  }),
                })}
              />
              {treasuries.map((tr) => (
                <SourceOption
                  key={tr.wallet.id}
                  selected={
                    source.kind === "treasury" && source.nodeId === tr.wallet.nodeId
                  }
                  onSelect={() =>
                    setSource({
                      kind: "treasury",
                      nodeId: tr.wallet.nodeId ?? "",
                    })
                  }
                  title={tr.label}
                  subtitle={t("wallet.source.treasury", {
                    amount: formatAmount(tr.wallet.balance, {
                      currency: tr.wallet.currency,
                    }),
                  })}
                  accent
                />
              ))}
            </div>
          </fieldset>
        ) : (
          <p className="mt-4 text-xs text-foreground/50">
            {t("wallet.personalOnly.prefix")}{" "}
            <span className="font-mono tabular-nums text-foreground">
              {formatAmount(personal.balance, { currency: personal.currency })}
            </span>
          </p>
        )}

        <div className="mt-5">
          <label className="block text-xs uppercase tracking-widest text-foreground/50">
            {t("wallet.recipient")}
          </label>
          <div className="mt-2 flex gap-2">
            <select
              value={destKind}
              onChange={(e) => setDestKind(e.target.value as DestinationKind)}
              className="rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground"
            >
              <option value="user">{t("wallet.recipient.userModal")}</option>
              <option value="treasury">
                {t("wallet.recipient.treasuryModal")}
              </option>
              <option value="walletId">{t("wallet.recipient.walletId")}</option>
            </select>
            <input
              type="text"
              value={destValue}
              onChange={(e) => setDestValue(e.target.value)}
              placeholder={placeholderFor(destKind)}
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
            />
          </div>
        </div>

        <div className="mt-5">
          <label className="block text-xs uppercase tracking-widest text-foreground/50">
            {t("wallet.amount")}
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className={cn(
              "mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-right font-mono text-lg tabular-nums text-foreground",
              !amountValid && amount.length > 0 && "border-rose-500/60",
            )}
          />
        </div>

        <div className="mt-5">
          <label className="block text-xs uppercase tracking-widest text-foreground/50">
            {t("wallet.memo")}
          </label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            maxLength={280}
            placeholder={t("wallet.memoPh")}
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            variant="crown"
            disabled={submitting || !amountValid || !enoughFunds}
          >
            {submitting ? t("common.sending") : t("common.confirm")}
          </Button>
        </div>
      </form>
    </div>
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
    >
      <div>
        <p className={cn("text-sm font-medium", accent && "text-crown")}>
          {title}
        </p>
        <p className="text-xs text-foreground/50">{subtitle}</p>
      </div>
      <span
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
  if (kind === "user") return { kind: "user" as const, userId: trimmed };
  if (kind === "treasury")
    return { kind: "treasury" as const, nodeId: trimmed };
  return { kind: "walletId" as const, walletId: trimmed };
}
