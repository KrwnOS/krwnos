/**
 * Governance Rules — «конституция самого голосования».
 * ------------------------------------------------------------
 * Живут в `StateSettings.governanceRules` (JSONB). Этот файл —
 * единый источник правды о форме блока, defaults-ах, способах
 * валидации и whitelist-е ключей `StateSettings`, которыми
 * разрешено управлять через DAO.
 *
 * Почему в ядре:
 *   * Тот же трюк, что у Exchange Engine — модуль `core.governance`
 *     лениво использует этот файл, но сами типы нужны и роутам, и
 *     Палате Указов (чтобы Суверен мог их редактировать), и
 *     StateConfigService (чтобы отдавать их по `GET /state/constitution`).
 *   * Core остаётся persistence-agnostic: это чистые типы и pure
 *     функции, без Prisma / Next.
 *
 * Три режима работы Парламента:
 *   * `decree`        — голосование выключено (или закрыто). Только
 *                       Суверен изменяет параметры. Модуль позволяет
 *                       создавать предложения только для чтения —
 *                       они висят в ленте как «жалобы», не влияют
 *                       ни на что.
 *   * `consultation`  — граждане голосуют; по окончании Суверен
 *                       принимает решение вручную (`POST /execute`
 *                       или `/veto`). Ничего не применяется само.
 *   * `auto_dao`      — успешные голосования автоматически
 *                       применяются через Executor. Суверен всё ещё
 *                       может вернуть вето, если не выключил
 *                       `sovereignVeto: false`.
 *
 * Basis points (bps):
 *   Проценты хранятся в bps (0..10000) — это дешевле, чем плавающая
 *   точка, и избавляет от IEEE-754 округлений. Быстрый конвертер:
 *   10000 bps = 100%, 6000 bps = 60%.
 */

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

export type GovernanceMode = "decree" | "consultation" | "auto_dao";

export type WeightStrategy =
  | "one_person_one_vote"
  | "by_node_weight"
  | "by_balance";

export interface GovernanceRules {
  mode: GovernanceMode;
  /**
   * Если true, Суверен может наложить вето на любое предложение
   * — до или после закрытия голосования. В auto_dao-режиме это
   * «Конституция с правом вето»: DAO работает автоматически, но
   * Суверен сохраняет возможность откатить решение.
   */
  sovereignVeto: boolean;
  /** Минимальная доля проголосовавших от общего веса электората. */
  quorumBps: number;
  /** Минимальная доля "за" среди всех поданных голосов. */
  thresholdBps: number;
  /** Длительность голосования от создания до автоматического закрытия. */
  votingDurationSeconds: number;
  /** Как считать вес голоса. */
  weightStrategy: WeightStrategy;
  /**
   * Стратегия `by_node_weight` берёт вес из этой мапы: ключ — cuid
   * узла, значение — количество «виртуальных голосов». Пользователь
   * получает максимум среди своих узлов (не сумму — чтобы смешение
   * ролей не раздувало электорат).
   */
  nodeWeights: Record<string, number>;
  /**
   * Для `by_balance` — какой актив считать «акциями». null =
   * primary-asset государства (вычисляется сервисом).
   */
  balanceAssetId: string | null;
  /**
   * Минимальная permission-ключ для создания предложения. null =
   * любой пользователь с `governance.propose`.
   */
  minProposerPermission: string | null;
  /**
   * Минимальный остаток на кошельке primary-валюты, чтобы иметь
   * право создать предложение (anti-spam для больших стран).
   */
  minProposerBalance: number | null;
  /**
   * Whitelist: какие `targetConfigKey` вообще допустимы в
   * предложениях. Пустой массив = ничего (режим только-для-чтения),
   * строка `"*"` в массиве = все ключи из
   * `GOVERNANCE_MANAGEABLE_KEYS`.
   */
  allowedConfigKeys: string[];
}

// ------------------------------------------------------------
// Defaults
// ------------------------------------------------------------

/**
 * Дефолт — голосование в режиме «Указ»: модуль установлен, но
 * реально ничего не решает. Суверен сам включит DAO через
 * `/admin/constitution`.
 */
export const DEFAULT_GOVERNANCE_RULES: GovernanceRules = {
  mode: "decree",
  sovereignVeto: true,
  quorumBps: 2_000, // 20%
  thresholdBps: 6_000, // 60%
  votingDurationSeconds: 3 * 24 * 60 * 60, // 3 дня
  weightStrategy: "one_person_one_vote",
  nodeWeights: {},
  balanceAssetId: null,
  minProposerPermission: null,
  minProposerBalance: null,
  allowedConfigKeys: [],
};

// ------------------------------------------------------------
// Whitelist of `StateSettings` keys DAO-proposals may mutate
// ------------------------------------------------------------

/**
 * Каноничный список ключей, которые Парламент МОЖЕТ предложить
 * изменить. Это сознательно ýже, чем полный `UpdateStateSettingsPatch`
 * — некоторые поля должны оставаться исключительной прерогативой
 * Суверена (например, сам блок `governanceRules`, плата за
 * гражданство в рантайме).
 *
 * Когда добавляется новый «безопасный» рычаг — его ключ следует
 * добавить сюда. Для обратной совместимости держим строковые ключи,
 * а не `keyof UpdateStateSettingsPatch`: старые предложения в БД не
 * должны падать, если колонка переименована.
 */
export const GOVERNANCE_MANAGEABLE_KEYS = [
  "transactionTaxRate",
  "incomeTaxRate",
  "roleTaxRate",
  "payrollEnabled",
  "payrollAmountPerCitizen",
  "currencyDisplayName",
  "citizenshipFeeAmount",
  "rolesPurchasable",
  "exitRefundRate",
  "permissionInheritance",
  "autoPromotionEnabled",
  "autoPromotionMinBalance",
  "autoPromotionMinDays",
  "autoPromotionTargetNodeId",
  "treasuryTransparency",
  "walletFine",
] as const;

export type GovernanceManageableKey =
  (typeof GOVERNANCE_MANAGEABLE_KEYS)[number];

export function isGovernanceManageableKey(
  key: string,
): key is GovernanceManageableKey {
  return (GOVERNANCE_MANAGEABLE_KEYS as readonly string[]).includes(key);
}

/**
 * Эффективный whitelist с учётом `allowedConfigKeys`. Применяется
 * при создании предложения, чтобы быстро отклонить `targetConfigKey`,
 * который Суверен не разрешил.
 *
 *   * Пустой массив         → ничего нельзя предлагать (mode-независимо).
 *   * `["*"]`                → разрешены все ключи из `GOVERNANCE_MANAGEABLE_KEYS`.
 *   * Обычный массив        → пересечение с `GOVERNANCE_MANAGEABLE_KEYS`.
 */
export function resolveAllowedKeys(
  rules: GovernanceRules,
): ReadonlySet<GovernanceManageableKey> {
  if (!rules.allowedConfigKeys || rules.allowedConfigKeys.length === 0) {
    return new Set();
  }
  if (rules.allowedConfigKeys.includes("*")) {
    return new Set(GOVERNANCE_MANAGEABLE_KEYS);
  }
  const out = new Set<GovernanceManageableKey>();
  for (const key of rules.allowedConfigKeys) {
    if (isGovernanceManageableKey(key)) out.add(key);
  }
  return out;
}

// ------------------------------------------------------------
// Validation / normalisation
// ------------------------------------------------------------

export class GovernanceRulesError extends Error {
  constructor(message: string, public readonly field: string) {
    super(message);
    this.name = "GovernanceRulesError";
  }
}

/**
 * Разбирает произвольный JSON (что лежит в БД / пришло в PATCH) в
 * полный `GovernanceRules` с дефолтами. Неизвестные ключи
 * игнорируются — это прямой путь к forward-compat: новые поля
 * появятся в ядре, старые записи продолжат работать.
 */
export function normaliseGovernanceRules(
  raw: unknown,
): GovernanceRules {
  const base = { ...DEFAULT_GOVERNANCE_RULES };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.mode === "string" && isMode(obj.mode)) base.mode = obj.mode;
  if (typeof obj.sovereignVeto === "boolean") {
    base.sovereignVeto = obj.sovereignVeto;
  }
  if (typeof obj.quorumBps === "number" && isBps(obj.quorumBps)) {
    base.quorumBps = Math.round(obj.quorumBps);
  }
  if (typeof obj.thresholdBps === "number" && isBps(obj.thresholdBps)) {
    base.thresholdBps = Math.round(obj.thresholdBps);
  }
  if (
    typeof obj.votingDurationSeconds === "number" &&
    Number.isFinite(obj.votingDurationSeconds) &&
    obj.votingDurationSeconds >= 60 &&
    obj.votingDurationSeconds <= 60 * 60 * 24 * 365
  ) {
    base.votingDurationSeconds = Math.round(obj.votingDurationSeconds);
  }
  if (typeof obj.weightStrategy === "string" && isWeightStrategy(obj.weightStrategy)) {
    base.weightStrategy = obj.weightStrategy;
  }
  if (
    obj.nodeWeights &&
    typeof obj.nodeWeights === "object" &&
    !Array.isArray(obj.nodeWeights)
  ) {
    const cleaned: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj.nodeWeights as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        cleaned[k] = v;
      }
    }
    base.nodeWeights = cleaned;
  }
  if (typeof obj.balanceAssetId === "string" && obj.balanceAssetId.length > 0) {
    base.balanceAssetId = obj.balanceAssetId;
  } else if (obj.balanceAssetId === null) {
    base.balanceAssetId = null;
  }
  if (typeof obj.minProposerPermission === "string" && obj.minProposerPermission.length > 0) {
    base.minProposerPermission = obj.minProposerPermission;
  } else if (obj.minProposerPermission === null) {
    base.minProposerPermission = null;
  }
  if (
    typeof obj.minProposerBalance === "number" &&
    Number.isFinite(obj.minProposerBalance) &&
    obj.minProposerBalance >= 0
  ) {
    base.minProposerBalance = obj.minProposerBalance;
  } else if (obj.minProposerBalance === null) {
    base.minProposerBalance = null;
  }
  if (Array.isArray(obj.allowedConfigKeys)) {
    base.allowedConfigKeys = obj.allowedConfigKeys
      .filter((k): k is string => typeof k === "string")
      .map((k) => k.trim())
      .filter((k) => k.length > 0 && (k === "*" || isGovernanceManageableKey(k)));
  }

  return base;
}

/**
 * Строгий валидатор — используется при PATCH `governanceRules`.
 * Отличается от `normaliseGovernanceRules` тем, что БРОСАЕТ
 * осмысленную ошибку вместо молчаливого подставления дефолта. Это
 * важно, чтобы Суверен понимал, почему его указ не вступил в силу.
 */
export function validateGovernanceRulesPatch(patch: unknown): Partial<GovernanceRules> {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new GovernanceRulesError(
      "governanceRules must be a plain object.",
      "governanceRules",
    );
  }
  const obj = patch as Record<string, unknown>;
  const out: Partial<GovernanceRules> = {};

  if (obj.mode !== undefined) {
    if (typeof obj.mode !== "string" || !isMode(obj.mode)) {
      throw new GovernanceRulesError(
        "governanceRules.mode must be one of decree|consultation|auto_dao.",
        "mode",
      );
    }
    out.mode = obj.mode;
  }
  if (obj.sovereignVeto !== undefined) {
    out.sovereignVeto = Boolean(obj.sovereignVeto);
  }
  if (obj.quorumBps !== undefined) {
    if (typeof obj.quorumBps !== "number" || !isBps(obj.quorumBps)) {
      throw new GovernanceRulesError(
        "governanceRules.quorumBps must be an integer in [0, 10000].",
        "quorumBps",
      );
    }
    out.quorumBps = Math.round(obj.quorumBps);
  }
  if (obj.thresholdBps !== undefined) {
    if (typeof obj.thresholdBps !== "number" || !isBps(obj.thresholdBps)) {
      throw new GovernanceRulesError(
        "governanceRules.thresholdBps must be an integer in [0, 10000].",
        "thresholdBps",
      );
    }
    out.thresholdBps = Math.round(obj.thresholdBps);
  }
  if (obj.votingDurationSeconds !== undefined) {
    if (
      typeof obj.votingDurationSeconds !== "number" ||
      !Number.isFinite(obj.votingDurationSeconds) ||
      obj.votingDurationSeconds < 60 ||
      obj.votingDurationSeconds > 60 * 60 * 24 * 365
    ) {
      throw new GovernanceRulesError(
        "governanceRules.votingDurationSeconds must be between 60 and 31536000.",
        "votingDurationSeconds",
      );
    }
    out.votingDurationSeconds = Math.round(obj.votingDurationSeconds);
  }
  if (obj.weightStrategy !== undefined) {
    if (typeof obj.weightStrategy !== "string" || !isWeightStrategy(obj.weightStrategy)) {
      throw new GovernanceRulesError(
        "governanceRules.weightStrategy invalid.",
        "weightStrategy",
      );
    }
    out.weightStrategy = obj.weightStrategy;
  }
  if (obj.nodeWeights !== undefined) {
    if (!obj.nodeWeights || typeof obj.nodeWeights !== "object" || Array.isArray(obj.nodeWeights)) {
      throw new GovernanceRulesError(
        "governanceRules.nodeWeights must be a plain object.",
        "nodeWeights",
      );
    }
    const cleaned: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj.nodeWeights as Record<string, unknown>)) {
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
        throw new GovernanceRulesError(
          `governanceRules.nodeWeights["${k}"] must be a positive number.`,
          "nodeWeights",
        );
      }
      cleaned[k] = v;
    }
    out.nodeWeights = cleaned;
  }
  if (obj.balanceAssetId !== undefined) {
    if (obj.balanceAssetId === null) {
      out.balanceAssetId = null;
    } else if (typeof obj.balanceAssetId === "string" && obj.balanceAssetId.length > 0) {
      out.balanceAssetId = obj.balanceAssetId;
    } else {
      throw new GovernanceRulesError(
        "governanceRules.balanceAssetId must be a string or null.",
        "balanceAssetId",
      );
    }
  }
  if (obj.minProposerPermission !== undefined) {
    if (obj.minProposerPermission === null) {
      out.minProposerPermission = null;
    } else if (typeof obj.minProposerPermission === "string") {
      out.minProposerPermission = obj.minProposerPermission;
    } else {
      throw new GovernanceRulesError(
        "governanceRules.minProposerPermission must be a string or null.",
        "minProposerPermission",
      );
    }
  }
  if (obj.minProposerBalance !== undefined) {
    if (obj.minProposerBalance === null) {
      out.minProposerBalance = null;
    } else if (
      typeof obj.minProposerBalance === "number" &&
      Number.isFinite(obj.minProposerBalance) &&
      obj.minProposerBalance >= 0
    ) {
      out.minProposerBalance = obj.minProposerBalance;
    } else {
      throw new GovernanceRulesError(
        "governanceRules.minProposerBalance must be a non-negative number or null.",
        "minProposerBalance",
      );
    }
  }
  if (obj.allowedConfigKeys !== undefined) {
    if (!Array.isArray(obj.allowedConfigKeys)) {
      throw new GovernanceRulesError(
        "governanceRules.allowedConfigKeys must be an array of strings.",
        "allowedConfigKeys",
      );
    }
    const cleaned: string[] = [];
    for (const raw of obj.allowedConfigKeys) {
      if (typeof raw !== "string") {
        throw new GovernanceRulesError(
          "governanceRules.allowedConfigKeys must be an array of strings.",
          "allowedConfigKeys",
        );
      }
      const k = raw.trim();
      if (k === "") continue;
      if (k !== "*" && !isGovernanceManageableKey(k)) {
        throw new GovernanceRulesError(
          `governanceRules.allowedConfigKeys: "${k}" is not a manageable key.`,
          "allowedConfigKeys",
        );
      }
      cleaned.push(k);
    }
    out.allowedConfigKeys = cleaned;
  }

  return out;
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function isMode(s: string): s is GovernanceMode {
  return s === "decree" || s === "consultation" || s === "auto_dao";
}

function isWeightStrategy(s: string): s is WeightStrategy {
  return (
    s === "one_person_one_vote" ||
    s === "by_node_weight" ||
    s === "by_balance"
  );
}

function isBps(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 10_000 &&
    Number.isInteger(Math.round(value))
  );
}
