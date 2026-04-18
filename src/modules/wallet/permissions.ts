/**
 * Canonical permission keys declared by the `core.wallet` module.
 *
 * The wallet module owns the `wallet.*` namespace. Every permission
 * a route handler or UI component checks MUST reference one of the
 * constants below — never a raw string — so that rename-safety and
 * grep-ability are preserved.
 */

import type { PermissionDescriptor, PermissionKey } from "@/types/kernel";

export const WalletPermissions = {
  /** View the balance + history of one's own personal wallet. */
  ViewOwn: "wallet.view_own" as PermissionKey,
  /**
   * View a node's treasury (budget). The Permissions Engine further
   * restricts this to members of the node or any of its ancestors.
   */
  ViewTreasury: "wallet.view_treasury" as PermissionKey,
  /**
   * Initiate a transfer from a wallet the user may spend from
   * (their own personal wallet, or a treasury they control).
   */
  Transfer: "wallet.transfer" as PermissionKey,
  /**
   * Spend from a node's treasury. Holder must ALSO be a member of
   * the node or any of its ancestors (Sovereign bypasses). This is
   * the "Минфин" permission — it's orthogonal to `wallet.view_treasury`
   * which only grants read-only visibility.
   */
  ManageTreasury: "wallet.manage_treasury" as PermissionKey,
  /**
   * Sovereign-only (by convention): mint new Kronas into any wallet
   * of the State. Modules that grant this key to non-Sovereigns are
   * opting in to a monetary policy they own.
   */
  AdminMint: "wallet.admin_mint" as PermissionKey,
  /**
   * Currency Factory: declare / update / retire `StateAsset` rows
   * — internal ledger tokens, imported on-chain contracts, hybrid
   * pegs. Sovereign-only by default; granting this to a node turns
   * the holder into the State's "Минфин монетарной политики".
   */
  ManageAssets: "wallet.manage_assets" as PermissionKey,
} as const;

export const WALLET_MODULE_SLUG = "core.wallet";

export const walletPermissionDescriptors: PermissionDescriptor[] = [
  {
    key: WalletPermissions.ViewOwn,
    owner: WALLET_MODULE_SLUG,
    label: "Видеть свой кошелёк",
    description:
      "Разрешает пользователю видеть баланс и историю своего личного " +
      "кошелька внутри этого государства.",
  },
  {
    key: WalletPermissions.ViewTreasury,
    owner: WALLET_MODULE_SLUG,
    label: "Видеть казну узла",
    description:
      "Разрешает видеть бюджет (TreasuryWallet) узла Вертикали, а также " +
      "бюджеты подчинённых узлов. Дополнительно требуется членство в " +
      "узле или в одном из его родителей.",
  },
  {
    key: WalletPermissions.Transfer,
    owner: WALLET_MODULE_SLUG,
    label: "Переводить средства",
    description:
      "Разрешает инициировать перевод со своего личного кошелька. Для " +
      "перевода из казны узла дополнительно требуется `wallet.manage_treasury` " +
      "и членство в этом узле (или любом из его родителей).",
  },
  {
    key: WalletPermissions.ManageTreasury,
    owner: WALLET_MODULE_SLUG,
    label: "Распоряжаться казной",
    description:
      "Разрешает списывать средства с казны узла (TreasuryWallet). " +
      "Дополнительно требуется членство в узле или любом из его " +
      "родителей — Суверен обходит обе проверки. Это «министерское» " +
      "право: обычно наследуется от узла к подузлам через Вертикаль.",
  },
  {
    key: WalletPermissions.AdminMint,
    owner: WALLET_MODULE_SLUG,
    label: "Эмитировать валюту",
    description:
      "Создавать (mint) новые единицы внутренней валюты государства. " +
      "По умолчанию выдаётся только Суверену — это инструмент " +
      "монетарной политики.",
  },
  {
    key: WalletPermissions.ManageAssets,
    owner: WALLET_MODULE_SLUG,
    label: "Настраивать национальную валюту",
    description:
      "Определять активы государства через Фабрику Валют: внутренний " +
      "леджер (Local Ledger), импорт внешнего токена (ON_CHAIN) или " +
      "гибридный режим с пеггингом к реальной крипте. По умолчанию " +
      "доступно только Суверену.",
    sovereignOnly: false,
  },
];
