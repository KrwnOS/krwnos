/**
 * POST /api/cli/modules   — install a module into a State
 * GET  /api/cli/modules   — list installed modules for the authed State
 *
 * These handlers are thin adapters. All domain logic lives in
 * core services so the same ops can be triggered from the UI.
 */

import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimitedResponse } from "@/lib/rate-limit";
import { registry } from "@/core";
import { authenticateCli, requireScope, CliAuthError } from "../auth";

const installSchema = z.object({
  slug: z.string().min(1),
  version: z.string().optional(),
  config: z.record(z.unknown()).optional(),
});

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
  const limited = await rateLimitedResponse(req, "api_cli");
  if (limited) return limited;

  try {
    const ctx = await authenticateCli(req, lookup);
    requireScope(ctx, "modules.read");

    if (!ctx.stateId) {
      return NextResponse.json(
        { error: "Token is not scoped to any State" },
        { status: 400 },
      );
    }

    const installed = await prisma.installedModule.findMany({
      where: { stateId: ctx.stateId },
      select: { slug: true, version: true, enabled: true, installedAt: true },
      orderBy: { installedAt: "asc" },
    });

    return NextResponse.json({ installed });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  const limited = await rateLimitedResponse(req, "api_cli");
  if (limited) return limited;

  try {
    const ctx = await authenticateCli(req, lookup);
    requireScope(ctx, "modules.write");

    if (!ctx.stateId) {
      return NextResponse.json(
        { error: "Token is not scoped to any State" },
        { status: 400 },
      );
    }

    const body = installSchema.parse(await req.json());
    const mod = registry.get(body.slug);
    if (!mod) {
      return NextResponse.json(
        { error: `Module "${body.slug}" is not registered in this build.` },
        { status: 404 },
      );
    }

    const row = await prisma.installedModule.upsert({
      where: { stateId_slug: { stateId: ctx.stateId, slug: body.slug } },
      create: {
        stateId: ctx.stateId,
        slug: body.slug,
        version: body.version ?? mod.version,
        config: (body.config ?? {}) as Prisma.InputJsonValue,
        dbSchema: `krwn_${body.slug.replace(/\./g, "_")}_${ctx.stateId.slice(0, 8)}`,
      },
      update: {
        enabled: true,
        version: body.version ?? mod.version,
        config: (body.config ?? {}) as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({ installed: row }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown) {
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
