/**
 * POST /api/cli/vertical  — add a node to the Vertical
 * GET  /api/cli/vertical  — dump the tree
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimitedResponse } from "@/lib/rate-limit";
import { authenticateCli, requireScope, CliAuthError } from "../auth";

const addSchema = z.object({
  title: z.string().min(1).max(120),
  parentId: z.string().nullable().optional(),
  type: z.enum(["position", "department", "rank"]).default("position"),
  permissions: z.array(z.string()).optional(),
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
    requireScope(ctx, "vertical.read");
    if (!ctx.stateId) return badRequest("Token is not scoped to any State");

    const nodes = await prisma.verticalNode.findMany({
      where: { stateId: ctx.stateId },
      orderBy: [{ parentId: "asc" }, { order: "asc" }],
    });
    return NextResponse.json({ nodes });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  const limited = await rateLimitedResponse(req, "api_cli");
  if (limited) return limited;

  try {
    const ctx = await authenticateCli(req, lookup);
    requireScope(ctx, "vertical.write");
    if (!ctx.stateId) return badRequest("Token is not scoped to any State");

    const body = addSchema.parse(await req.json());

    if (body.parentId) {
      const parent = await prisma.verticalNode.findUnique({
        where: { id: body.parentId },
        select: { stateId: true },
      });
      if (!parent || parent.stateId !== ctx.stateId) {
        return badRequest("parentId does not belong to this State");
      }
    }

    const maxOrder = await prisma.verticalNode.aggregate({
      where: { stateId: ctx.stateId, parentId: body.parentId ?? null },
      _max: { order: true },
    });

    const node = await prisma.verticalNode.create({
      data: {
        stateId: ctx.stateId,
        parentId: body.parentId ?? null,
        title: body.title,
        type: body.type,
        permissions: body.permissions ?? [],
        order: (maxOrder._max.order ?? 0) + 1,
      },
    });

    return NextResponse.json({ node }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

function badRequest(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
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
