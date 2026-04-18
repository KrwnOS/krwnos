/**
 * `POST /api/wallet/assets/:assetId/primary`
 * ------------------------------------------------------------
 * "Установить государственную валюту" — promote the given asset
 * to the State's primary (national) currency. Exactly one asset
 * per State holds the `isPrimary = true` flag; the repo clears
 * the old one inside the same transaction.
 *
 * Gated by `wallet.manage_assets` (Sovereign bypasses). Powered
 * by `CurrencyFactoryService.setPrimaryAsset` — this route is a
 * thin transport shim.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  CurrencyFactoryService,
  createPrismaCurrencyFactoryRepository,
} from "@/modules/wallet";
import { loadWalletContext, walletErrorResponse } from "../../../_context";
import { factoryErrorResponse } from "../../_errors";

type Ctx = { params: Promise<{ assetId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { assetId } = await ctx.params;
    const { stateId, access } = await loadWalletContext(req);

    const factory = new CurrencyFactoryService({
      repo: createPrismaCurrencyFactoryRepository(prisma),
    });
    const asset = await factory.setPrimaryAsset(stateId, access, assetId);
    return NextResponse.json({ asset });
  } catch (err) {
    return factoryErrorResponse(err) ?? walletErrorResponse(err);
  }
}
