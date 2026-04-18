/**
 * GET /api/cli/status — deployment + tunnel + version info.
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateCli, CliAuthError } from "../auth";

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

export async function GET(req: NextRequest) {
  try {
    const ctx = await authenticateCli(req, lookup);

    const tunnel = ctx.stateId
      ? await prisma.tunnel.findUnique({ where: { stateId: ctx.stateId } })
      : null;

    return NextResponse.json({
      tier: (process.env.KRWN_TIER as "sandbox" | "pro" | "cloud") ?? "pro",
      version: process.env.KRWN_VERSION ?? "0.1.0",
      hostname: req.nextUrl.host,
      tunnel: tunnel
        ? {
            provider: tunnel.provider,
            enabled: tunnel.provider !== "none",
            publicUrl: tunnel.hostname
              ? `https://${tunnel.hostname}`
              : undefined,
          }
        : { provider: "none", enabled: false },
    });
  } catch (err) {
    if (err instanceof CliAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 500 },
    );
  }
}
