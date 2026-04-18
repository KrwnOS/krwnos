"use client";

/**
 * WalletWidget — compact wallet card for the top navbar.
 * ------------------------------------------------------------
 * Renders the caller's balance ("Моя казна") and a clickable,
 * copy-to-clipboard internal address. Fetches data from
 * `/api/wallet/me` on mount using the CLI bearer token stored at
 * `localStorage["krwn.cli_token"]`.
 *
 * Built on top of the shadcn `Card` + `Button` primitives to stay
 * visually consistent with the rest of the UI.
 */

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  formatAmount,
  shortAddress,
  KRONA_SYMBOL,
  type WalletDto,
  type TransactionDto,
} from "@/components/wallet";

export interface WalletWidgetProps {
  className?: string;
  /** Bearer token override. If omitted, read from localStorage. */
  authToken?: string;
  /** Triggered when the user clicks the "Перевести" CTA. */
  onTransferClick?: () => void;
  /** Override label above the balance. Defaults to "Моя казна". */
  label?: string;
}

interface MeResponse {
  wallet: WalletDto;
  transactions: TransactionDto[];
}

const TOKEN_STORAGE_KEY = "krwn.cli_token";

export function WalletWidget({
  className,
  authToken,
  onTransferClick,
  label = "Моя казна",
}: WalletWidgetProps): React.ReactElement {
  const [wallet, setWallet] = React.useState<WalletDto | null>(null);
  const [token, setToken] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (authToken) {
      setToken(authToken);
      return;
    }
    try {
      setToken(window.localStorage.getItem(TOKEN_STORAGE_KEY));
    } catch {
      setToken(null);
    }
  }, [authToken]);

  React.useEffect(() => {
    let cancelled = false;
    if (!token) {
      setLoading(false);
      setWallet(null);
      return;
    }
    setLoading(true);
    fetch("/api/wallet/me", {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then(async (res) => (res.ok ? ((await res.json()) as MeResponse) : null))
      .then((data) => {
        if (!cancelled) setWallet(data?.wallet ?? null);
      })
      .catch(() => {
        if (!cancelled) setWallet(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const copyAddress = React.useCallback(async () => {
    if (!wallet) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — silently ignore */
    }
  }, [wallet]);

  if (!token) {
    return (
      <Card
        className={cn(
          "flex items-center gap-2 px-3 py-1.5",
          className,
        )}
      >
        <span className="text-xs text-foreground/40">Wallet offline</span>
      </Card>
    );
  }

  if (loading && !wallet) {
    return (
      <Card className={cn("px-3 py-1.5", className)}>
        <span className="text-xs text-foreground/40">Загрузка…</span>
      </Card>
    );
  }

  if (!wallet) {
    return (
      <Card className={cn("px-3 py-1.5", className)}>
        <span className="text-xs text-foreground/40">Нет кошелька</span>
      </Card>
    );
  }

  const isTreasury = wallet.type === "TREASURY";

  return (
    <Card
      className={cn(
        "flex items-center gap-3 px-3 py-2",
        isTreasury && "border-crown/40",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm font-bold",
          isTreasury ? "bg-foreground/10 text-foreground" : "bg-crown text-black",
        )}
      >
        {KRONA_SYMBOL}
      </span>

      <div className="flex min-w-0 flex-col leading-tight">
        <span className="text-[10px] uppercase tracking-widest text-foreground/50">
          {label}
        </span>
        <span
          className={cn(
            "font-mono text-sm font-semibold tabular-nums",
            isTreasury ? "text-crown" : "text-foreground",
          )}
        >
          {formatAmount(wallet.balance, { currency: wallet.currency })}
        </span>
      </div>

      <button
        type="button"
        onClick={copyAddress}
        title="Скопировать адрес"
        className="hidden rounded-md px-2 py-1 font-mono text-[11px] text-foreground/60 transition-colors hover:text-foreground sm:inline-flex"
      >
        {copied ? "скопировано" : shortAddress(wallet.address, 6, 4)}
      </button>

      {onTransferClick ? (
        <Button
          type="button"
          size="sm"
          variant={isTreasury ? "crown" : "outline"}
          onClick={onTransferClick}
          className="ml-1"
        >
          Перевести
        </Button>
      ) : null}
    </Card>
  );
}
