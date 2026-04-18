"use client";

/**
 * TransactionHistory — chronological list of wallet operations.
 * ------------------------------------------------------------
 * Renders direction (incoming / outgoing / mint / burn) relative
 * to a reference wallet. Amounts are rendered with a signed
 * prefix ("+" / "−") in the accent color.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { useI18n, type TFunction } from "@/lib/i18n";
import { formatAmount, toNumber } from "./format";
import type { TransactionDto } from "./types";

export interface TransactionHistoryProps {
  /** Wallet id used to compute the direction of each row. */
  walletId: string;
  transactions: TransactionDto[];
  className?: string;
  /** Shown when `transactions` is empty. */
  emptyHint?: React.ReactNode;
}

type Direction = "in" | "out" | "mint" | "burn" | "neutral";

function directionOf(tx: TransactionDto, walletId: string): Direction {
  if (tx.kind === "mint" && tx.toWalletId === walletId) return "mint";
  if (tx.kind === "burn" && tx.fromWalletId === walletId) return "burn";
  if (tx.toWalletId === walletId) return "in";
  if (tx.fromWalletId === walletId) return "out";
  return "neutral";
}

export function TransactionHistory({
  walletId,
  transactions,
  className,
  emptyHint,
}: TransactionHistoryProps): React.ReactElement {
  const { t, formatDateTime } = useI18n();

  if (transactions.length === 0) {
    return (
      <div
        className={cn(
          "rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-foreground/50",
          className,
        )}
      >
        {emptyHint ?? t("wallet.noOperations")}
      </div>
    );
  }

  return (
    <ul className={cn("divide-y divide-border/40", className)}>
      {transactions.map((tx) => {
        const dir = directionOf(tx, walletId);
        const amount = toNumber(tx.amount);
        const signed = dir === "in" || dir === "mint" ? amount : -amount;
        const isFailed = tx.status !== "completed";

        return (
          <li
            key={tx.id}
            className="flex items-center justify-between gap-4 py-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span
                className={cn(
                  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  dir === "in" &&
                    "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
                  dir === "out" &&
                    "border-rose-500/30 bg-rose-500/10 text-rose-300",
                  dir === "mint" && "border-crown/40 bg-crown/10 text-crown",
                  dir === "burn" &&
                    "border-foreground/30 bg-foreground/10 text-foreground/70",
                  dir === "neutral" && "border-border bg-background/40",
                )}
                aria-hidden
              >
                {arrowFor(dir)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">
                  {labelFor(tx, dir, t)}
                </p>
                <p className="truncate text-xs text-foreground/50">
                  {formatDateTime(tx.createdAt)}
                  {isFailed ? (
                    <>
                      {" · "}
                      <span className="text-rose-400">
                        {statusLabel(tx.status, t)}
                      </span>
                    </>
                  ) : null}
                </p>
              </div>
            </div>

            <span
              className={cn(
                "shrink-0 font-mono text-sm tabular-nums",
                isFailed && "line-through opacity-50",
                dir === "in" || dir === "mint" ? "text-emerald-300" : "",
                dir === "out" || dir === "burn" ? "text-rose-300" : "",
              )}
            >
              {signed >= 0 ? "+" : ""}
              {formatAmount(signed, { currency: tx.currency })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function arrowFor(dir: Direction): string {
  switch (dir) {
    case "in":
      return "↓";
    case "out":
      return "↑";
    case "mint":
      return "＋";
    case "burn":
      return "✕";
    default:
      return "•";
  }
}

function labelFor(tx: TransactionDto, dir: Direction, t: TFunction): string {
  const memo = typeof tx.metadata?.memo === "string" ? tx.metadata.memo : null;
  if (memo) return memo;

  switch (tx.kind) {
    case "mint":
      return dir === "mint" ? t("wallet.tx.mint.in") : t("wallet.tx.mint");
    case "burn":
      return t("wallet.tx.burn");
    case "treasury_allocation":
      return dir === "in" || dir === "out"
        ? t("wallet.tx.treasuryFrom")
        : t("wallet.tx.treasuryOp");
    case "transfer":
    default:
      return dir === "in"
        ? t("wallet.tx.transferIn")
        : t("wallet.tx.transferOut");
  }
}

function statusLabel(s: TransactionDto["status"], t: TFunction): string {
  switch (s) {
    case "failed":
      return t("wallet.tx.status.failed");
    case "pending":
      return t("wallet.tx.status.pending");
    case "reversed":
      return t("wallet.tx.status.reversed");
    default:
      return s;
  }
}
