/**
 * Wire-format DTOs shared between wallet UI components. Balances
 * and amounts are plain JS numbers (schema stores them as `Float`).
 * The helpers in `./format.ts` normalise them for display.
 */

export type WalletKind = "PERSONAL" | "TREASURY";

export interface WalletDto {
  id: string;
  stateId: string;
  type: WalletKind;
  userId: string | null;
  nodeId: string | null;
  address: string;
  balance: number;
  currency: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type TransactionKindDto =
  | "transfer"
  | "treasury_allocation"
  | "mint"
  | "burn";

export type TransactionStatusDto =
  | "pending"
  | "completed"
  | "failed"
  | "reversed";

export interface TransactionDto {
  id: string;
  stateId: string;
  fromWalletId: string | null;
  toWalletId: string | null;
  kind: TransactionKindDto;
  status: TransactionStatusDto;
  amount: number;
  currency: string;
  metadata: Record<string, unknown>;
  initiatedById: string;
  createdAt: string;
}

export interface TreasurySummaryDto {
  wallet: WalletDto;
  node: {
    id: string;
    title: string;
    type: "position" | "department" | "rank";
  } | null;
}
