/**
 * `GET /api/wallet/supply/:assetId`
 * ------------------------------------------------------------
 * "Публичность" — public circulating-supply readout. This
 * endpoint is UNAUTHENTICATED by design: citizens (and outsiders)
 * need a reliable way to audit the State's monetary policy
 * without holding a CLI token.
 *
 * Privacy is controlled by the asset's `publicSupply` flag. When
 * `publicSupply = false`, the endpoint returns 403 even for the
 * Sovereign — the intent is auditability, not ACL bypass. To
 * expose the number, flip the flag via the Currency Factory.
 *
 * The response is intentionally minimal so it's cheap to fetch
 * and safe to cache:
 *   {
 *     asset: { id, symbol, name, decimals, isPrimary, type, mode },
 *     supply: <number>,      // aggregate positive balances
 *     asOf:   <ISO timestamp>
 *   }
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  CurrencyFactoryError,
  CurrencyFactoryService,
  createPrismaCurrencyFactoryRepository,
} from "@/modules/wallet";

type Ctx = { params: Promise<{ assetId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { assetId } = await ctx.params;

    // We can't use `loadWalletContext` here — this endpoint is
    // intentionally public. Resolve the `stateId` straight from
    // the asset row so the client doesn't have to send it.
    const row = (await (prisma as unknown as {
      stateAsset: {
        findUnique: (args: unknown) => Promise<{ stateId: string } | null>;
      };
    }).stateAsset.findUnique({
      where: { id: assetId },
      select: { stateId: true },
    })) as { stateId: string } | null;

    if (!row) {
      return NextResponse.json(
        { error: "Asset not found.", code: "not_found" },
        { status: 404 },
      );
    }

    const factory = new CurrencyFactoryService({
      repo: createPrismaCurrencyFactoryRepository(prisma),
    });
    const result = await factory.getPublicSupply(row.stateId, assetId);

    if (!result) {
      return NextResponse.json(
        {
          error:
            "Supply is private for this asset. Ask the Sovereign to enable `publicSupply`.",
          code: "forbidden",
        },
        { status: 403 },
      );
    }

    const { asset, supply } = result;
    return NextResponse.json(
      {
        asset: {
          id: asset.id,
          symbol: asset.symbol,
          name: asset.name,
          decimals: asset.decimals,
          isPrimary: asset.isPrimary,
          type: asset.type,
          mode: asset.mode,
        },
        supply,
        asOf: new Date().toISOString(),
      },
      {
        // Short TTL: the number changes every transfer. 15s is
        // low enough to feel live while still soaking up the
        // burst traffic you get when citizens refresh dashboards.
        headers: { "cache-control": "public, max-age=15" },
      },
    );
  } catch (err) {
    if (err instanceof CurrencyFactoryError) {
      const status =
        err.code === "not_found"
          ? 404
          : err.code === "forbidden"
            ? 403
            : 400;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 500 },
    );
  }
}
