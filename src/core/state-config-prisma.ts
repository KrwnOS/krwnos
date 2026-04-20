/**
 * Prisma adapter for `StateConfigRepository`.
 * ------------------------------------------------------------
 * Живёт рядом с `src/core/state-config.ts`, потому что только он
 * смотрит в БД — сам сервис остаётся чистым. Тесты подкладывают
 * in-memory fake через контракт репозитория.
 *
 * Ленивое создание: `ensure()` использует `upsert({ where:
 * { stateId }, create: <defaults>, update: {} })`, чтобы:
 *   (а) не ловить race-condition при одновременном чтении двух
 *       инстансов;
 *   (б) совместимо работать с миграционным seed-ом (см.
 *       `20260419210000_state_settings/migration.sql`).
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  DEFAULT_GOVERNANCE_RULES,
  normaliseGovernanceRules,
} from "./governance-rules";
import type {
  StateConfigRepository,
  StateSettings,
  TreasuryTransparency,
  UpdateStateSettingsPatch,
} from "./state-config";

/** Prisma может быть старше, чем сгенерированный клиент — берём loose-shape. */
type LooseDelegate = {
  findUnique: (args: unknown) => Promise<unknown>;
  upsert: (args: unknown) => Promise<unknown>;
  update: (args: unknown) => Promise<unknown>;
};

interface PrismaStateSettingsRow {
  id: string;
  stateId: string;
  transactionTaxRate: number;
  incomeTaxRate: number;
  roleTaxRate: number;
  payrollEnabled: boolean;
  payrollAmountPerCitizen: number;
  currencyDisplayName: string | null;
  citizenshipFeeAmount: number;
  rolesPurchasable: boolean;
  exitRefundRate: number;
  permissionInheritance: boolean;
  autoPromotionEnabled: boolean;
  autoPromotionMinBalance: number | null;
  autoPromotionMinDays: number | null;
  autoPromotionTargetNodeId: string | null;
  treasuryTransparency: TreasuryTransparency;
  governanceRules: unknown;
  extras: unknown;
  uiLocale: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function createPrismaStateConfigRepository(
  prisma: PrismaClient,
): StateConfigRepository {
  const loose = prisma as unknown as { stateSettings: LooseDelegate };

  return {
    async find(stateId) {
      const row = (await loose.stateSettings.findUnique({
        where: { stateId },
      })) as PrismaStateSettingsRow | null;
      return row ? mapRow(row) : null;
    },

    async ensure(stateId) {
      const row = (await loose.stateSettings.upsert({
        where: { stateId },
        update: {},
        create: { stateId },
      })) as PrismaStateSettingsRow;
      return mapRow(row);
    },

    async update(stateId, patch) {
      // `governanceRules` — JSONB, и patch даётся частичным. Нам
      // нужен read-modify-write, чтобы не терять ранее сохранённые
      // поля (например, nodeWeights при изменении quorumBps).
      // Остальные колонки — скалярные, их безопасно писать напрямую.
      const existing = (await loose.stateSettings.findUnique({
        where: { stateId },
      })) as PrismaStateSettingsRow | null;

      const data = toPrismaUpdate(patch);

      if (patch.governanceRules !== undefined) {
        const current = existing
          ? normaliseGovernanceRules(existing.governanceRules)
          : { ...DEFAULT_GOVERNANCE_RULES };
        const merged = { ...current, ...patch.governanceRules };
        data.governanceRules = merged as unknown as Prisma.InputJsonValue;
      }

      // Upsert так же, как ensure — если строки нет, создаём её
      // с дефолтами, а затем накатываем patch. Избавляет вызовщика
      // от необходимости дёргать `ensure()` перед первым изменением.
      const row = (await loose.stateSettings.upsert({
        where: { stateId },
        update: data,
        create: { stateId, ...data },
      })) as PrismaStateSettingsRow;
      return mapRow(row);
    },
  };
}

function mapRow(row: PrismaStateSettingsRow): StateSettings {
  return {
    id: row.id,
    stateId: row.stateId,
    transactionTaxRate: row.transactionTaxRate,
    incomeTaxRate: row.incomeTaxRate,
    roleTaxRate: row.roleTaxRate,
    payrollEnabled: row.payrollEnabled ?? false,
    payrollAmountPerCitizen: row.payrollAmountPerCitizen ?? 0,
    currencyDisplayName: row.currencyDisplayName,
    citizenshipFeeAmount: row.citizenshipFeeAmount,
    rolesPurchasable: row.rolesPurchasable,
    exitRefundRate: row.exitRefundRate,
    permissionInheritance: row.permissionInheritance,
    autoPromotionEnabled: row.autoPromotionEnabled,
    autoPromotionMinBalance: row.autoPromotionMinBalance,
    autoPromotionMinDays: row.autoPromotionMinDays,
    autoPromotionTargetNodeId: row.autoPromotionTargetNodeId,
    treasuryTransparency: row.treasuryTransparency,
    governanceRules: normaliseGovernanceRules(row.governanceRules),
    extras:
      row.extras && typeof row.extras === "object" && !Array.isArray(row.extras)
        ? (row.extras as Record<string, unknown>)
        : {},
    uiLocale: row.uiLocale ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toPrismaUpdate(
  patch: UpdateStateSettingsPatch,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  // Простой shallow-copy: сервис уже выполнил валидацию. Отдельный
  // каст нужен только у `extras`, потому что Prisma ждёт
  // `Prisma.InputJsonValue`.
  const keys: (keyof UpdateStateSettingsPatch)[] = [
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
    "uiLocale",
  ];
  for (const key of keys) {
    const value = patch[key];
    if (value !== undefined) data[key] = value;
  }
  if (patch.extras !== undefined) {
    data.extras = patch.extras as Prisma.InputJsonValue;
  }
  return data;
}
