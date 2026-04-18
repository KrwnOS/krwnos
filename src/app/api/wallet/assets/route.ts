/**
 * `/api/wallet/assets`
 * ------------------------------------------------------------
 * Currency Factory — list + create endpoints. Every citizen who
 * reached `loadWalletContext()` may READ the asset registry (the
 * Factory is explicitly non-secret — "Публичность" is a per-asset
 * flag for the *supply* number, not the definition itself).
 *
 * Only the Sovereign (`isOwner`) or holders of
 * `wallet.manage_assets` / `wallet.admin_mint` may CREATE.
 * Creation gating lives in `CurrencyFactoryService` so the route
 * handler stays thin.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  CurrencyFactoryService,
  createPrismaCurrencyFactoryRepository,
} from "@/modules/wallet";
import { loadWalletContext, walletErrorResponse } from "../_context";
import { factoryErrorResponse } from "./_errors";

function buildFactory(): CurrencyFactoryService {
  return new CurrencyFactoryService({
    repo: createPrismaCurrencyFactoryRepository(prisma),
  });
}

const CreateAssetSchema = z.object({
  symbol: z.string().min(2).max(16),
  name: z.string().min(1).max(64),
  type: z.enum(["INTERNAL", "ON_CHAIN"]),
  mode: z.enum(["LOCAL", "EXTERNAL", "HYBRID"]).optional(),
  contractAddress: z.string().nullable().optional(),
  network: z.string().nullable().optional(),
  chainId: z.number().int().nullable().optional(),
  decimals: z.number().int().min(0).max(36).optional(),
  exchangeRate: z.number().positive().nullable().optional(),
  icon: z.string().max(8).nullable().optional(),
  color: z.string().max(32).nullable().optional(),
  isPrimary: z.boolean().optional(),
  canMint: z.boolean().optional(),
  taxRate: z.number().min(0).max(1).optional(),
  publicSupply: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const { stateId } = await loadWalletContext(req);
    const factory = buildFactory();
    const assets = await factory.listAssets(stateId);
    return NextResponse.json({ assets });
  } catch (err) {
    return factoryErrorResponse(err) ?? walletErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { stateId, access } = await loadWalletContext(req);
    const body = await req.json();
    const input = CreateAssetSchema.parse(body);

    const factory = buildFactory();
    const asset = await factory.createAsset(stateId, access, input);
    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    return factoryErrorResponse(err) ?? walletErrorResponse(err);
  }
}
