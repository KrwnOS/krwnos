/**
 * `/api/wallet/assets/:assetId`
 * ------------------------------------------------------------
 * Read / update / retire a single StateAsset.
 *
 *   * `GET`    — any authenticated citizen of the State.
 *   * `PATCH`  — Sovereign or `wallet.manage_assets`.
 *   * `DELETE` — Sovereign or `wallet.manage_assets`. Refuses if
 *                the asset is primary or has referencing wallets.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  CurrencyFactoryService,
  createPrismaCurrencyFactoryRepository,
} from "@/modules/wallet";
import { loadWalletContext, walletErrorResponse } from "../../_context";
import { factoryErrorResponse } from "../_errors";

function buildFactory(): CurrencyFactoryService {
  return new CurrencyFactoryService({
    repo: createPrismaCurrencyFactoryRepository(prisma),
  });
}

const UpdatePatchSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  mode: z.enum(["LOCAL", "EXTERNAL", "HYBRID"]).optional(),
  contractAddress: z.string().nullable().optional(),
  network: z.string().nullable().optional(),
  chainId: z.number().int().nullable().optional(),
  decimals: z.number().int().min(0).max(36).optional(),
  exchangeRate: z.number().positive().nullable().optional(),
  icon: z.string().max(8).nullable().optional(),
  color: z.string().max(32).nullable().optional(),
  canMint: z.boolean().optional(),
  taxRate: z.number().min(0).max(1).optional(),
  publicSupply: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

type Ctx = { params: Promise<{ assetId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const { assetId } = await ctx.params;
    const { stateId } = await loadWalletContext(req);
    const factory = buildFactory();
    const asset = await factory.getAsset(stateId, assetId);
    return NextResponse.json({ asset });
  } catch (err) {
    return factoryErrorResponse(err) ?? walletErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { assetId } = await ctx.params;
    const { stateId, access } = await loadWalletContext(req);
    const body = await req.json();
    const patch = UpdatePatchSchema.parse(body);

    const factory = buildFactory();
    const asset = await factory.updateAsset(stateId, access, assetId, patch);
    return NextResponse.json({ asset });
  } catch (err) {
    return factoryErrorResponse(err) ?? walletErrorResponse(err);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const { assetId } = await ctx.params;
    const { stateId, access } = await loadWalletContext(req);
    const factory = buildFactory();
    const asset = await factory.retireAsset(stateId, access, assetId);
    return NextResponse.json({ asset });
  } catch (err) {
    return factoryErrorResponse(err) ?? walletErrorResponse(err);
  }
}
