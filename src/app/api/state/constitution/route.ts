/**
 * `/api/state/constitution` — Палата Указов (Sovereign's Decree).
 * ------------------------------------------------------------
 * GET   — любой аутентифицированный гражданин читает текущий свод
 *         законов (законы должны быть прозрачны).
 * PATCH — только Суверен или держатель core `state.configure`.
 *         `StateConfigService` сам проверяет право; роут лишь
 *         маппит коды ошибок в HTTP-статусы.
 *
 * Транспорт: Bearer-токен CLI (тот же, что у `/api/wallet/*`).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  loadStateContext,
  serialiseForWire,
  stateErrorResponse,
} from "../_context";
import { isLocale } from "@/lib/i18n/locales";

const PatchSchema = z
  .object({
    transactionTaxRate: z.number().min(0).max(1).optional(),
    incomeTaxRate: z.number().min(0).max(1).optional(),
    roleTaxRate: z.number().min(0).max(1).optional(),
    payrollEnabled: z.boolean().optional(),
    payrollAmountPerCitizen: z.number().min(0).optional(),
    currencyDisplayName: z.string().max(64).nullable().optional(),

    citizenshipFeeAmount: z.number().min(0).optional(),
    rolesPurchasable: z.boolean().optional(),
    exitRefundRate: z.number().min(0).max(1).optional(),

    permissionInheritance: z.boolean().optional(),
    autoPromotionEnabled: z.boolean().optional(),
    autoPromotionMinBalance: z.number().min(0).nullable().optional(),
    autoPromotionMinDays: z.number().int().min(0).max(36_500).nullable().optional(),
    autoPromotionTargetNodeId: z.string().min(1).max(64).nullable().optional(),
    treasuryTransparency: z.enum(["public", "council", "sovereign"]).optional(),

    // Governance rules — free-form object; `StateConfigService`
    // делегирует валидацию `validateGovernanceRulesPatch`, поэтому
    // здесь нам достаточно убедиться, что это объект, а не массив.
    governanceRules: z.record(z.string(), z.unknown()).optional(),

    extras: z.record(z.string(), z.unknown()).optional(),

    uiLocale: z
      .string()
      .max(8)
      .nullable()
      .optional()
      .refine(
        (v) =>
          v === undefined ||
          v === null ||
          (typeof v === "string" && isLocale(v.trim().toLowerCase())),
        { message: "invalid uiLocale" },
      ),
  })
  .strict();

export async function GET(req: NextRequest) {
  try {
    const { stateId, service } = await loadStateContext(req);
    const settings = await service.get(stateId);
    return NextResponse.json({ settings: serialiseForWire(settings) });
  } catch (err) {
    return stateErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { stateId, service, access } = await loadStateContext(req);
    const body = await req.json();
    const patch = PatchSchema.parse(body);
    const settings = await service.update(stateId, access, patch);
    return NextResponse.json({ settings: serialiseForWire(settings) });
  } catch (err) {
    return stateErrorResponse(err);
  }
}
