/**
 * POST /api/cli/tokens/rotate
 *
 * Rotates the CURRENT bearer token:
 *   1. Mints a new token with same scopes/state/expiry (unless overridden).
 *   2. Revokes the token used to authenticate this request.
 *   3. Returns plaintext of the new token — shown once.
 *
 * The caller MUST persist the new token and discard the old one
 * immediately; no grace window is provided.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticateCli, CliAuthError } from "../../auth";
import { CliTokenService } from "@/core/cli-tokens";
import { cliTokenRepository } from "@/lib/cli-tokens-repo";

const body = z
  .object({
    label: z.string().min(1).max(64).optional(),
    scopes: z.array(z.string()).min(1).optional(),
    ttlMs: z
      .number()
      .int()
      .min(60_000)
      .max(1000 * 60 * 60 * 24 * 365)
      .nullable()
      .optional(),
  })
  .default({});

const service = new CliTokenService(cliTokenRepository);

const lookup = {
  findByHash: async (tokenHash: string) =>
    prisma.cliToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        stateId: true,
        scopes: true,
        expiresAt: true,
        revokedAt: true,
      },
    }),
  touch: async (id: string) =>
    void (await prisma.cliToken.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    })),
};

export async function POST(req: NextRequest) {
  try {
    const ctx = await authenticateCli(req, lookup);
    const input = body.parse(
      req.headers.get("content-length") === "0" ? {} : await req.json().catch(() => ({})),
    );

    const result = await service.rotate({
      currentTokenId: ctx.tokenId,
      label: input.label,
      scopes: input.scopes,
      ttlMs: input.ttlMs === null ? null : input.ttlMs,
    });

    return NextResponse.json({
      revokedTokenId: result.revokedTokenId,
      tokenId: result.row.id,
      token: result.token,
      label: result.row.label,
      scopes: result.row.scopes,
      expiresAt: result.row.expiresAt,
    });
  } catch (err) {
    if (err instanceof CliAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 500 },
    );
  }
}
