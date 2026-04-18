"use client";

/**
 * TransactionList — recent wallet activity, rendered as a list.
 * ------------------------------------------------------------
 * Each row shows:
 *   * A direction icon (↓ in / ↑ out / ＋ mint / ✕ burn).
 *   * The memo (if present) or a human label derived from `kind`.
 *   * The timestamp and — when the tx failed / reversed — a
 *     coloured status marker.
 *   * The signed amount, coloured green for inflows and red for
 *     outflows.
 *
 * Direction is computed relative to the `walletId` prop, so the
 * same transaction looks like an inflow on the recipient's screen
 * and an outflow on the sender's.
 */

import * as React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  formatAmount,
  toNumber,
  type TransactionDto,
} from "@/components/wallet";

export interface TransactionListProps {
  /** Wallet id used to compute the direction of each row. */
  walletId: string;
  transactions: TransactionDto[];
  /** Optional heading above the list. */
  title?: React.ReactNode;
  /** Shown when `transactions` is empty. */
  emptyHint?: React.ReactNode;
  className?: string;
}

type Direction = "in" | "out" | "mint" | "burn" | "neutral";

export function TransactionList({
  walletId,
  transactions,
  title = "Последние транзакции",
  emptyHint,
  className,
}: TransactionListProps): React.ReactElement {
  if (transactions.length === 0) {
    return (
      <Card className={cn("text-center text-sm text-foreground/50", className)}>
        {title ? (
          <h3 className="mb-3 text-left text-sm font-semibold uppercase tracking-widest text-foreground/60">
            {title}
          </h3>
        ) : null}
        <p className="py-6">{emptyHint ?? "Операций пока нет."}</p>
      </Card>
    );
  }

  return (
    <Card className={cn("p-0", className)}>
      {title ? (
        <h3 className="border-b border-border/40 px-5 py-3 text-sm font-semibold uppercase tracking-widest text-foreground/60">
          {title}
        </h3>
      ) : null}
      <ul className="divide-y divide-border/40">
        {transactions.map((tx) => (
          <TransactionRow key={tx.id} tx={tx} walletId={walletId} />
        ))}
      </ul>
    </Card>
  );
}

function TransactionRow({
  tx,
  walletId,
}: {
  tx: TransactionDto;
  walletId: string;
}): React.ReactElement {
  const dir = directionOf(tx, walletId);
  const amount = toNumber(tx.amount);
  const incoming = dir === "in" || dir === "mint";
  const signed = incoming ? amount : -amount;
  const failed = tx.status !== "completed";

  return (
    <li className="flex items-center justify-between gap-4 px-5 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
            dir === "in" &&
              "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
            dir === "out" &&
              "border-rose-500/40 bg-rose-500/10 text-rose-300",
            dir === "mint" && "border-crown/50 bg-crown/10 text-crown",
            dir === "burn" &&
              "border-foreground/30 bg-foreground/10 text-foreground/70",
            dir === "neutral" && "border-border bg-background/40",
          )}
        >
          {arrowFor(dir)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm text-foreground">
            {labelFor(tx, dir)}
          </p>
          <p className="truncate text-xs text-foreground/50">
            {new Date(tx.createdAt).toLocaleString("ru-RU")}
            {failed ? (
              <>
                {" · "}
                <span className="text-rose-400">{statusLabel(tx.status)}</span>
              </>
            ) : null}
          </p>
        </div>
      </div>

      <span
        className={cn(
          "shrink-0 font-mono text-sm tabular-nums",
          failed && "line-through opacity-60",
          incoming && "text-emerald-300",
          !incoming && dir !== "neutral" && "text-rose-300",
        )}
      >
        {signed >= 0 ? "+" : ""}
        {formatAmount(signed, { currency: tx.currency })}
      </span>
    </li>
  );
}

function directionOf(tx: TransactionDto, walletId: string): Direction {
  if (tx.kind === "mint" && tx.toWalletId === walletId) return "mint";
  if (tx.kind === "burn" && tx.fromWalletId === walletId) return "burn";
  if (tx.toWalletId === walletId) return "in";
  if (tx.fromWalletId === walletId) return "out";
  return "neutral";
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

function labelFor(tx: TransactionDto, dir: Direction): string {
  const memo = typeof tx.metadata?.memo === "string" ? tx.metadata.memo : null;
  if (memo) return memo;

  switch (tx.kind) {
    case "mint":
      return dir === "mint" ? "Эмиссия (приход)" : "Эмиссия";
    case "burn":
      return "Burn";
    case "treasury_allocation":
      return "Казначейская операция";
    case "transfer":
    default:
      return dir === "in" ? "Входящий перевод" : "Исходящий перевод";
  }
}

function statusLabel(s: TransactionDto["status"]): string {
  switch (s) {
    case "failed":
      return "отклонено";
    case "pending":
      return "в обработке";
    case "reversed":
      return "отменено";
    default:
      return s;
  }
}
