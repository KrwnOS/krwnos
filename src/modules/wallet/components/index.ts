/**
 * Public surface of the wallet UI. Import from here instead of
 * individual component files — we can swap internals freely.
 *
 * These are the module-owned views: `WalletWidget` for the top
 * navbar, `TransferForm` for the perevod flow, and `TransactionList`
 * for the recent-activity feed. Low-level primitives (WalletCard,
 * WalletNavbar, TransferModal) still live under `@/components/wallet`.
 */

export { WalletWidget, type WalletWidgetProps } from "./WalletWidget";
export {
  TransferForm,
  type TransferFormProps,
  type TransferFormTreasury,
  type SourceChoice,
} from "./TransferForm";
export {
  TransactionList,
  type TransactionListProps,
} from "./TransactionList";
