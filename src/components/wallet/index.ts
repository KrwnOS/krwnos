/**
 * Barrel export for the wallet UI kit. Keep this file server-safe:
 * re-export types + "use client" components by reference — importing
 * this file from a RSC module won't drag client runtime into the
 * server bundle (Next.js handles the boundary automatically).
 */

export { WalletCard, type WalletCardProps } from "./WalletCard";
export {
  TransactionHistory,
  type TransactionHistoryProps,
} from "./TransactionHistory";
export { TransferModal, type TransferModalProps } from "./TransferModal";
export { WalletNavbar, type WalletNavbarProps } from "./WalletNavbar";

export {
  formatAmount,
  formatKrona,
  shortAddress,
  toNumber,
  parseAmountInput,
  KRONA_SYMBOL,
  DEFAULT_CURRENCY,
} from "./format";

export type {
  WalletDto,
  TransactionDto,
  TransactionKindDto,
  TransactionStatusDto,
  WalletKind,
  TreasurySummaryDto,
} from "./types";
