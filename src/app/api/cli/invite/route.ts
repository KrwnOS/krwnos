/**
 * POST /api/cli/invite  — issue a magic-link invitation.
 *
 * Returns the one-time `token` and shareable `url`. Token is
 * NEVER stored in plaintext; DB keeps only SHA-256(token).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimitedResponse } from "@/lib/rate-limit";
import {
  InvitationsService,
  type InvitationsRepository,
} from "@/core/invitations";
import { authenticateCli, requireScope, CliAuthError } from "../auth";

const schema = z.object({
  targetNodeId: z.string().nullable().optional(),
  label: z.string().max(120).optional(),
  maxUses: z.number().int().min(1).max(10_000).default(1),
  ttlMs: z
    .number()
    .int()
    .min(60_000)
    .max(1000 * 60 * 60 * 24 * 365)
    .optional(),
});

const repo: InvitationsRepository = {
  insert: async (row) => {
    const inv = await prisma.invitation.create({
      data: {
        id: row.id,
        stateId: row.stateId,
        targetNodeId: row.targetNodeId,
        createdById: row.createdById,
        tokenHash: row.tokenHash,
        code: row.code,
        label: row.label,
        maxUses: row.maxUses,
        expiresAt: row.expiresAt,
      },
    });
    return toDomain(inv);
  },
  findByTokenHash: async (hash) => {
    const row = await prisma.invitation.findUnique({ where: { tokenHash: hash } });
    return row ? toDomain(row) : null;
  },
  findByCode: async (code) => {
    const row = await prisma.invitation.findUnique({ where: { code } });
    return row ? toDomain(row) : null;
  },
  updateStatus: async (id, status, consumedAt) => {
    await prisma.invitation.update({
      where: { id },
      data: { status, consumedAt: consumedAt ?? null },
    });
  },
  incrementUses: async (id) => {
    const row = await prisma.invitation.update({
      where: { id },
      data: { usesCount: { increment: 1 } },
    });
    return toDomain(row);
  },
  createMembership: async (userId, nodeId) => {
    await prisma.membership.upsert({
      where: { userId_nodeId: { userId, nodeId } },
      create: { userId, nodeId },
      update: {},
    });
  },
};

const service = new InvitationsService(repo);

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
  const limited = await rateLimitedResponse(req, "api_cli");
  if (limited) return limited;

  try {
    const ctx = await authenticateCli(req, lookup);
    requireScope(ctx, "invitations.create");
    if (!ctx.stateId) {
      return NextResponse.json(
        { error: "Token is not scoped to any State" },
        { status: 400 },
      );
    }

    const body = schema.parse(await req.json());

    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { id: true, handle: true, displayName: true, avatarUrl: true },
    });
    if (!user) throw new CliAuthError("User vanished", 401);

    const issued = await service.create({
      stateId: ctx.stateId,
      targetNodeId: body.targetNodeId ?? null,
      createdBy: user,
      label: body.label,
      maxUses: body.maxUses,
      ttlMs: body.ttlMs,
      origin: req.nextUrl.origin,
    });

    return NextResponse.json(
      {
        invitation: issued.invitation,
        token: issued.token,
        url: issued.url,
      },
      { status: 201 },
    );
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

function toDomain(row: {
  id: string;
  stateId: string;
  targetNodeId: string | null;
  createdById: string;
  code: string;
  label: string | null;
  maxUses: number;
  usesCount: number;
  expiresAt: Date | null;
  status: string;
  createdAt: Date;
  consumedAt: Date | null;
}) {
  return {
    id: row.id,
    stateId: row.stateId,
    targetNodeId: row.targetNodeId,
    createdById: row.createdById,
    code: row.code,
    label: row.label,
    maxUses: row.maxUses,
    usesCount: row.usesCount,
    expiresAt: row.expiresAt,
    status: row.status as "active" | "consumed" | "revoked" | "expired",
    createdAt: row.createdAt,
    consumedAt: row.consumedAt,
  };
}
