/**
 * StateConfigService — Палата Указов (Sovereign's Decree).
 * ------------------------------------------------------------
 * Единый свод «конституциональных» параметров государства. Всё,
 * чем Суверен может программировать поведение своей песочницы —
 * от ставки налога на перевод до условий авто-продвижения
 * гражданина — живёт в `StateSettings` и читается каждым модулем
 * через этот сервис.
 *
 * Почему в ядре, а не в `modules/wallet`:
 *   * Настройки шире финансов: правила входа, прозрачность казны,
 *     наследование прав в Вертикали — всё это одновременно читают
 *     модули `wallet`, `chat`, `invitations`, а также сам
 *     `PermissionsEngine`. Единый владелец — ядро.
 *   * «Палата Указов» — это декларация; конкретные модули оставляют
 *     за собой право игнорировать знаки (например, ON_CHAIN-активы
 *     не могут применить `transactionTaxRate`, см. `WalletService`).
 *
 * Сервис persistence-agnostic: тесты подсовывают in-memory fake,
 * продовый рантайм — Prisma-адаптер из `state-config-prisma.ts`.
 *
 * Канонические события:
 *     "core.state.settings.updated"
 *
 * Разрешения: читать — любой аутентифицированный гражданин; писать
 * — Суверен или держатель core-permission `state.configure`. Ключ
 * регистрируется через `registerCorePermissions()` наряду с
 * ключами Exchange Engine.
 */

import type {
  ModuleEventBus,
  PermissionDescriptor,
  PermissionKey,
} from "@/types/kernel";
import {
  DEFAULT_GOVERNANCE_RULES,
  GovernanceRulesError,
  normaliseGovernanceRules,
  validateGovernanceRulesPatch,
  type GovernanceRules,
} from "./governance-rules";

// ------------------------------------------------------------
// Permissions
// ------------------------------------------------------------

export const StateConfigPermissions = {
  /**
   * Редактировать Палату Указов. По умолчанию — только Суверен,
   * но его можно явно делегировать любому узлу Вертикали (например,
   * «Парламент» получает `state.configure`, чтобы менять налоги
   * без участия Суверена).
   */
  Configure: "state.configure" as PermissionKey,
  /**
   * Читать настройки может любой пользователь, но мы всё равно
   * объявляем ключ — пригодится для тонкой настройки аудита или
   * внешних аналитических ролей.
   */
  View: "state.view_settings" as PermissionKey,
} as const;

export const STATE_CONFIG_MODULE_SLUG = "core";

export const stateConfigPermissionDescriptors: PermissionDescriptor[] = [
  {
    key: StateConfigPermissions.Configure,
    owner: "core",
    label: "Править Палату Указов",
    description:
      "Менять глобальные параметры государства: фискальную политику, " +
      "правила входа/выхода, динамику Вертикали. По умолчанию " +
      "доступно только Суверену — может быть делегировано отдельным " +
      "узлам Вертикали (например, Парламенту).",
    sovereignOnly: false,
  },
  {
    key: StateConfigPermissions.View,
    owner: "core",
    label: "Читать Палату Указов",
    description:
      "Видеть текущие конституциональные параметры государства. " +
      "Выдаётся автоматически — каждый гражданин имеет право знать " +
      "законы, по которым живёт.",
  },
];

// ------------------------------------------------------------
// Domain types
// ------------------------------------------------------------

export type TreasuryTransparency = "public" | "council" | "sovereign";

/**
 * Полный свод параметров государства. Все числа — Float:
 *   * `*TaxRate`      — фракция в [0..1] (не проценты!). `0.05` =
 *                       5%, `1.0` = всё удерживается. Реализация в
 *                       модулях обязана интерпретировать именно так.
 *   * `*FeeAmount`    — абсолютные единицы первичной валюты
 *                       государства.
 *   * `*MinBalance`   — порог остатка для авто-продвижения.
 *   * `*MinDays`      — стаж в днях.
 *
 * `currencyDisplayName` — витрина; настоящая единица учёта остаётся
 * `StateAsset.symbol` первичного актива. Этот текст используется
 * только UI-модулями (подпись рядом с суммой, шапка /admin).
 *
 * `extras` — выход для будущих модулей. Любой модуль может
 * прочитать свой собственный ключ оттуда, но НЕ должен трогать
 * чужие записи без координации с владельцем slug-а.
 */
export interface StateSettings {
  id: string;
  stateId: string;

  // Fiscal
  transactionTaxRate: number;
  incomeTaxRate: number;
  roleTaxRate: number;
  currencyDisplayName: string | null;

  // Entry / exit
  citizenshipFeeAmount: number;
  rolesPurchasable: boolean;
  exitRefundRate: number;

  // Vertical dynamics
  permissionInheritance: boolean;
  autoPromotionEnabled: boolean;
  autoPromotionMinBalance: number | null;
  autoPromotionMinDays: number | null;
  autoPromotionTargetNodeId: string | null;
  treasuryTransparency: TreasuryTransparency;

  // Governance (Парламент)
  governanceRules: GovernanceRules;

  // Extras
  extras: Record<string, unknown>;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * Минимальная проекция — hot-path-friendly. Используется модулями,
 * которым не нужны все поля (например, WalletService хочет только
 * `transactionTaxRate` / `incomeTaxRate`). Шина `settings.updated`
 * публикует именно этот формат, чтобы слушатели могли дёшево
 * пересчитать кэши.
 */
export interface StateSettingsSummary {
  stateId: string;
  transactionTaxRate: number;
  incomeTaxRate: number;
  roleTaxRate: number;
  citizenshipFeeAmount: number;
  permissionInheritance: boolean;
  treasuryTransparency: TreasuryTransparency;
}

export function summariseSettings(
  settings: StateSettings,
): StateSettingsSummary {
  return {
    stateId: settings.stateId,
    transactionTaxRate: settings.transactionTaxRate,
    incomeTaxRate: settings.incomeTaxRate,
    roleTaxRate: settings.roleTaxRate,
    citizenshipFeeAmount: settings.citizenshipFeeAmount,
    permissionInheritance: settings.permissionInheritance,
    treasuryTransparency: settings.treasuryTransparency,
  };
}

export interface UpdateStateSettingsPatch {
  transactionTaxRate?: number;
  incomeTaxRate?: number;
  roleTaxRate?: number;
  currencyDisplayName?: string | null;

  citizenshipFeeAmount?: number;
  rolesPurchasable?: boolean;
  exitRefundRate?: number;

  permissionInheritance?: boolean;
  autoPromotionEnabled?: boolean;
  autoPromotionMinBalance?: number | null;
  autoPromotionMinDays?: number | null;
  autoPromotionTargetNodeId?: string | null;
  treasuryTransparency?: TreasuryTransparency;

  governanceRules?: Partial<GovernanceRules>;

  extras?: Record<string, unknown>;
}

/**
 * Дефолтные значения — эталон для setup-а и для любых мест, где
 * строка в БД может отсутствовать. Держим константой, чтобы тесты
 * и миграции не расходились.
 */
export const DEFAULT_STATE_SETTINGS: UpdateStateSettingsPatch = {
  transactionTaxRate: 0,
  incomeTaxRate: 0,
  roleTaxRate: 0,
  currencyDisplayName: null,

  citizenshipFeeAmount: 0,
  rolesPurchasable: false,
  exitRefundRate: 0,

  permissionInheritance: true,
  autoPromotionEnabled: false,
  autoPromotionMinBalance: null,
  autoPromotionMinDays: null,
  autoPromotionTargetNodeId: null,
  treasuryTransparency: "council",

  governanceRules: DEFAULT_GOVERNANCE_RULES,

  extras: {},
};

// ------------------------------------------------------------
// Repository contract
// ------------------------------------------------------------

export interface StateConfigRepository {
  find(stateId: string): Promise<StateSettings | null>;

  /**
   * Идемпотентное создание строки с дефолтами. Если ряд уже есть —
   * возвращает его без изменений. Нужен, чтобы setup и API могли
   * лениво инициализировать запись без race-condition.
   */
  ensure(stateId: string): Promise<StateSettings>;

  update(
    stateId: string,
    patch: UpdateStateSettingsPatch,
  ): Promise<StateSettings>;
}

// ------------------------------------------------------------
// Access context + errors
// ------------------------------------------------------------

export interface StateConfigAccessContext {
  userId: string;
  /** Суверен (owner) этого State. */
  isOwner: boolean;
  /** Полный набор эффективных прав пользователя. */
  permissions: ReadonlySet<PermissionKey>;
}

export type StateConfigErrorCode =
  | "forbidden"
  | "not_found"
  | "invalid_input";

export class StateConfigError extends Error {
  constructor(
    message: string,
    public readonly code: StateConfigErrorCode,
  ) {
    super(message);
    this.name = "StateConfigError";
  }
}

export const STATE_CONFIG_EVENTS = {
  Updated: "core.state.settings.updated",
} as const;

export interface StateSettingsUpdatedEvent {
  stateId: string;
  before: StateSettingsSummary;
  after: StateSettingsSummary;
  updatedById: string;
}

// ------------------------------------------------------------
// Service
// ------------------------------------------------------------

export interface StateConfigServiceDeps {
  repo: StateConfigRepository;
  /**
   * Optional event bus — тот же `ModuleEventBus`, что и у остальных
   * сервисов. Если не передан, сервис работает молча (удобно в тестах).
   */
  bus?: ModuleEventBus;
}

export class StateConfigService {
  private readonly repo: StateConfigRepository;
  private readonly bus: ModuleEventBus | null;

  constructor(deps: StateConfigServiceDeps) {
    this.repo = deps.repo;
    this.bus = deps.bus ?? null;
  }

  /**
   * Возвращает текущие настройки; если строки нет (старая БД без
   * миграции), лениво создаёт её с дефолтами. Этот метод открыт
   * для любого аутентифицированного пользователя — законы должны
   * быть прозрачны.
   */
  async get(stateId: string): Promise<StateSettings> {
    const existing = await this.repo.find(stateId);
    if (existing) return existing;
    return this.repo.ensure(stateId);
  }

  /**
   * То же, что `get`, но возвращает компактный summary для hot-path
   * модулей (WalletService, PermissionsEngine).
   */
  async getSummary(stateId: string): Promise<StateSettingsSummary> {
    const full = await this.get(stateId);
    return summariseSettings(full);
  }

  /**
   * Мутация. Только Суверен или держатель `state.configure`.
   * Все числовые поля валидируются перед записью — сервис не
   * полагается на guard-ы БД, чтобы сообщения об ошибках были
   * осмысленными.
   */
  async update(
    stateId: string,
    ctx: StateConfigAccessContext,
    patch: UpdateStateSettingsPatch,
  ): Promise<StateSettings> {
    this.requireConfigure(ctx);

    const clean = validatePatch(patch);
    const before = summariseSettings(await this.get(stateId));

    const updated = await this.repo.update(stateId, clean);
    const after = summariseSettings(updated);

    if (this.bus) {
      const event: StateSettingsUpdatedEvent = {
        stateId,
        before,
        after,
        updatedById: ctx.userId,
      };
      void this.bus
        .emit(STATE_CONFIG_EVENTS.Updated, event)
        .catch(() => {});
    }

    return updated;
  }

  /**
   * Idempotent bootstrap — вызывается из `setup-state.ts`. Создаёт
   * строку с дефолтами, ничего не трогая, если она уже есть.
   */
  async ensureDefaults(stateId: string): Promise<StateSettings> {
    return this.repo.ensure(stateId);
  }

  // --------------------------------------------------------
  // Internals
  // --------------------------------------------------------

  private requireConfigure(ctx: StateConfigAccessContext): void {
    if (ctx.isOwner) return;
    if (hasPermission(ctx.permissions, StateConfigPermissions.Configure)) {
      return;
    }
    throw new StateConfigError(
      `Missing permission "${StateConfigPermissions.Configure}".`,
      "forbidden",
    );
  }
}

// ------------------------------------------------------------
// Validation helpers (exported for tests)
// ------------------------------------------------------------

/**
 * Нормализует и валидирует patch. Возвращает КОПИЮ с очищенными
 * значениями (trim на строках, clamp на процентах и т.д.). Бросает
 * `StateConfigError("invalid_input")` с человеко-читаемым сообщением
 * при некорректных данных.
 */
export function validatePatch(
  patch: UpdateStateSettingsPatch,
): UpdateStateSettingsPatch {
  const out: UpdateStateSettingsPatch = {};

  if (patch.transactionTaxRate !== undefined) {
    out.transactionTaxRate = validateRate(
      patch.transactionTaxRate,
      "transactionTaxRate",
    );
  }
  if (patch.incomeTaxRate !== undefined) {
    out.incomeTaxRate = validateRate(patch.incomeTaxRate, "incomeTaxRate");
  }
  if (patch.roleTaxRate !== undefined) {
    out.roleTaxRate = validateRate(patch.roleTaxRate, "roleTaxRate");
  }
  if (patch.exitRefundRate !== undefined) {
    out.exitRefundRate = validateRate(patch.exitRefundRate, "exitRefundRate");
  }

  if (patch.citizenshipFeeAmount !== undefined) {
    out.citizenshipFeeAmount = validateNonNegative(
      patch.citizenshipFeeAmount,
      "citizenshipFeeAmount",
    );
  }

  if (patch.currencyDisplayName !== undefined) {
    if (patch.currencyDisplayName === null) {
      out.currencyDisplayName = null;
    } else {
      const trimmed = patch.currencyDisplayName.trim();
      if (trimmed.length > 64) {
        throw new StateConfigError(
          "currencyDisplayName must be ≤ 64 characters.",
          "invalid_input",
        );
      }
      out.currencyDisplayName = trimmed.length === 0 ? null : trimmed;
    }
  }

  if (patch.rolesPurchasable !== undefined) {
    out.rolesPurchasable = Boolean(patch.rolesPurchasable);
  }
  if (patch.permissionInheritance !== undefined) {
    out.permissionInheritance = Boolean(patch.permissionInheritance);
  }
  if (patch.autoPromotionEnabled !== undefined) {
    out.autoPromotionEnabled = Boolean(patch.autoPromotionEnabled);
  }

  if (patch.autoPromotionMinBalance !== undefined) {
    out.autoPromotionMinBalance =
      patch.autoPromotionMinBalance === null
        ? null
        : validateNonNegative(
            patch.autoPromotionMinBalance,
            "autoPromotionMinBalance",
          );
  }

  if (patch.autoPromotionMinDays !== undefined) {
    if (patch.autoPromotionMinDays === null) {
      out.autoPromotionMinDays = null;
    } else {
      if (
        !Number.isFinite(patch.autoPromotionMinDays) ||
        !Number.isInteger(patch.autoPromotionMinDays) ||
        patch.autoPromotionMinDays < 0 ||
        patch.autoPromotionMinDays > 36_500
      ) {
        throw new StateConfigError(
          "autoPromotionMinDays must be an integer in [0, 36500].",
          "invalid_input",
        );
      }
      out.autoPromotionMinDays = patch.autoPromotionMinDays;
    }
  }

  if (patch.autoPromotionTargetNodeId !== undefined) {
    if (patch.autoPromotionTargetNodeId === null) {
      out.autoPromotionTargetNodeId = null;
    } else {
      const id = patch.autoPromotionTargetNodeId.trim();
      if (id.length === 0 || id.length > 64) {
        throw new StateConfigError(
          "autoPromotionTargetNodeId must be a non-empty cuid.",
          "invalid_input",
        );
      }
      out.autoPromotionTargetNodeId = id;
    }
  }

  if (patch.treasuryTransparency !== undefined) {
    const allowed: TreasuryTransparency[] = ["public", "council", "sovereign"];
    if (!allowed.includes(patch.treasuryTransparency)) {
      throw new StateConfigError(
        `treasuryTransparency must be one of ${allowed.join(", ")}.`,
        "invalid_input",
      );
    }
    out.treasuryTransparency = patch.treasuryTransparency;
  }

  if (patch.governanceRules !== undefined) {
    try {
      out.governanceRules = validateGovernanceRulesPatch(patch.governanceRules);
    } catch (err) {
      if (err instanceof GovernanceRulesError) {
        throw new StateConfigError(err.message, "invalid_input");
      }
      throw err;
    }
  }

  if (patch.extras !== undefined) {
    if (
      patch.extras === null ||
      typeof patch.extras !== "object" ||
      Array.isArray(patch.extras)
    ) {
      throw new StateConfigError(
        "extras must be a plain object.",
        "invalid_input",
      );
    }
    out.extras = patch.extras;
  }

  return out;
}

function validateRate(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new StateConfigError(
      `${field} must be a finite number.`,
      "invalid_input",
    );
  }
  if (value < 0 || value > 1) {
    throw new StateConfigError(
      `${field} must be in [0, 1] (fraction, not percent).`,
      "invalid_input",
    );
  }
  return value;
}

function validateNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new StateConfigError(
      `${field} must be a finite number.`,
      "invalid_input",
    );
  }
  if (value < 0) {
    throw new StateConfigError(
      `${field} must be ≥ 0.`,
      "invalid_input",
    );
  }
  return value;
}

function hasPermission(
  held: ReadonlySet<PermissionKey>,
  required: PermissionKey,
): boolean {
  if (held.has("*")) return true;
  if (held.has(required)) return true;
  const [domain] = required.split(".");
  if (!domain) return false;
  return held.has(`${domain}.*` as PermissionKey);
}
