"use client";

/**
 * WalletCard — compact display of a wallet's balance and address.
 * ------------------------------------------------------------
 * Used both in the Navbar ("Мой кошелёк") and in the Sovereign
 * dashboard ("Состояние Королевства" — one card per treasury).
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { formatAmount, shortAddress } from "./format";
import type { WalletDto } from "./types";

export interface WalletCardProps {
  wallet: WalletDto;
  /** Optional caption, e.g. "Казначейство · Минфин". */
  label?: string;
  /** Renders the "Перевести" CTA below the balance. */
  onTransferClick?: () => void;
  /** Compact (navbar) or full (dashboard) styling. */
  variant?: "compact" | "full";
  className?: string;
}

export function WalletCard({
  wallet,
  label,
  onTransferClick,
  variant = "full",
  className,
}: WalletCardProps): React.ReactElement {
  const t = useT();
  const [copied, setCopied] = React.useState(false);

  const copy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — silently ignore */
    }
  }, [wallet.address]);

  const isTreasury = wallet.type === "TREASURY";

  if (variant === "compact") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border border-border/60 bg-background/40 px-3 py-1.5",
          className,
        )}
      >
        <span
          className={cn(
            "inline-flex h-6 w-6 items-center justify-center rounded-sm text-xs font-bold",
            isTreasury ? "bg-foreground/10 text-foreground" : "bg-crown text-black",
          )}
          aria-hidden
        >
          ⚜
        </span>
        <span className="font-mono text-sm tabular-nums text-foreground">
          {formatAmount(wallet.balance, {
            currency: wallet.currency,
            withSymbol: false,
          })}
        </span>
        <span className="text-xs text-foreground/50">
          {isTreasury ? t("wallet.type.treasury") : t("wallet.type.personal")}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-background/40 p-5 backdrop-blur-sm",
        isTreasury && "border-crown/30",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-foreground/50">
            {label ??
              (isTreasury ? t("wallet.treasury") : t("wallet.personalBalance"))}
          </p>
          <p
            className={cn(
              "mt-2 font-mono text-3xl font-semibold tabular-nums",
              isTreasury ? "text-crown" : "text-foreground",
            )}
          >
            {formatAmount(wallet.balance, { currency: wallet.currency })}
          </p>
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            isTreasury
              ? "bg-crown/10 text-crown"
              : "bg-foreground/10 text-foreground/80",
          )}
        >
          {isTreasury
            ? t("wallet.type.treasuryUpper")
            : t("wallet.type.personalUpper")}
        </span>
      </div>

      <button
        type="button"
        onClick={copy}
        className="mt-4 flex items-center gap-2 rounded-md px-0 py-0 font-mono text-xs text-foreground/60 transition-colors hover:text-foreground"
        title={t("common.copyAddress")}
      >
        <span>{shortAddress(wallet.address, 10, 8)}</span>
        <span className="text-foreground/40">
          {copied ? t("common.copied") : t("common.copy")}
        </span>
      </button>

      {onTransferClick ? (
        <button
          type="button"
          onClick={onTransferClick}
          className={cn(
            "mt-5 w-full rounded-md py-2 text-sm font-medium transition-colors",
            isTreasury
              ? "bg-crown text-black hover:bg-crown/90"
              : "border border-border bg-background/60 text-foreground hover:bg-foreground/5",
          )}
        >
          {t("wallet.transfer")}
        </button>
      ) : null}
    </div>
  );
}
