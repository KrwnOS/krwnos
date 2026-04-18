/**
 * POST /api/invite/:token/accept
 *
 * Web-facing invitation consumption endpoint. Requires a current
 * authenticated user (via the configured AuthAdapter). On success
 * redirects to the State desktop.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  InvitationsService,
  type InvitationsRepository,
} from "@/core/invitations";
import { getAuth, UnauthorizedError } from "@/core";

const repo: InvitationsRepository = {
  insert: async () => {
    throw new Error("insert not used from accept route");
  },
  findByTokenHash: async (hash) => {
    const row = await prisma.invitation.findUnique({ where: { tokenHash: hash } });
    return row as any;
  },
  findByCode: async (code) => {
    const row = await prisma.invitation.findUnique({ where: { code } });
    return row as any;
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
    return row as any;
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

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } },
) {
  try {
    const user = await getAuth().requireUser();

    const result = await service.consume({ token: params.token, user });

    const state = await prisma.state.findUnique({
      where: { id: result.invitation.stateId },
      select: { slug: true },
    });

    const url = new URL(`/s/${state?.slug ?? ""}`, req.nextUrl.origin);
    return NextResponse.redirect(url, { status: 303 });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      const loginUrl = new URL("/login", req.nextUrl.origin);
      loginUrl.searchParams.set("invite", params.token);
      return NextResponse.redirect(loginUrl, { status: 303 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 400 },
    );
  }
}
