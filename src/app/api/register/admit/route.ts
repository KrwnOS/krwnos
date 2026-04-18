/**
 * POST /api/register/admit
 * ------------------------------------------------------------
 * A superior admits a user who is currently in the Waiting Room
 * (`Membership.status = "pending"` on the State lobby node) into a
 * real node of the Vertical.
 *
 * Permissions:
 *   * Caller must be the Sovereign OR hold `invitations.create`
 *     on the target node (by ancestry — same rule used for invite
 *     issuance). Keeping the check light here; richer per-node
 *     ACLs land once the Vertical editor is wired.
 *
 * Body: { userId: string, targetNodeId: string, title?: string }
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { permissionsEngine } from "@/core";
import { InvitationPermissions } from "@/core/invitations";
import type {
  PermissionKey,
  VerticalNode,
  VerticalSnapshot,
} from "@/types/kernel";
import { authenticateCli, CliAuthError } from "../../cli/auth";

export const dynamic = "force-dynamic";

const body = z.object({
  userId: z.string().min(1),
  targetNodeId: z.string().min(1),
  title: z.string().max(80).optional(),
});

const cliLookup = {
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
    const cli = await authenticateCli(req, cliLookup);
    if (!cli.stateId) {
      return NextResponse.json({ error: "token_not_scoped" }, { status: 403 });
    }
    const stateId = cli.stateId;
    const parsed = body.parse(await req.json());

    const targetNode = await prisma.verticalNode.findUnique({
      where: { id: parsed.targetNodeId },
      select: { id: true, stateId: true, isLobby: true },
    });
    if (!targetNode || targetNode.stateId !== stateId) {
      return NextResponse.json(
        { error: "target_node_not_found" },
        { status: 404 },
      );
    }
    if (targetNode.isLobby) {
      return NextResponse.json(
        {
          error: "invalid_target",
          message: "Cannot admit someone INTO the Waiting Room.",
        },
        { status: 400 },
      );
    }

    const [state, nodes, memberships] = await Promise.all([
      prisma.state.findUnique({
        where: { id: stateId },
        select: { ownerId: true },
      }),
      prisma.verticalNode.findMany({
        where: { stateId },
        select: {
          id: true,
          stateId: true,
          parentId: true,
          title: true,
          type: true,
          permissions: true,
          order: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.membership.findMany({
        where: { node: { stateId }, status: "active" },
        select: { userId: true, nodeId: true },
      }),
    ]);

    if (!state) {
      return NextResponse.json({ error: "state_not_found" }, { status: 404 });
    }

    const snapshot: VerticalSnapshot = {
      stateId,
      nodes: new Map<string, VerticalNode>(
        nodes.map((n) => [
          n.id,
          { ...n, permissions: n.permissions as PermissionKey[] },
        ]),
      ),
      membershipsByUser: new Map(),
    };
    for (const m of memberships) {
      let set = snapshot.membershipsByUser.get(m.userId);
      if (!set) {
        set = new Set();
        snapshot.membershipsByUser.set(m.userId, set);
      }
      set.add(m.nodeId);
    }

    const isOwner = state.ownerId === cli.userId;
    const granted = permissionsEngine.can(
      { stateId, userId: cli.userId, isOwner, snapshot },
      InvitationPermissions.Create,
    );
    if (!isOwner && !granted) {
      return NextResponse.json(
        { error: "forbidden", code: "forbidden" },
        { status: 403 },
      );
    }

    // Promote: flip the lobby membership (if any) and create/activate
    // the target-node membership. Wallet is already provisioned by
    // open registration — nothing to create here.
    const lobby = await prisma.verticalNode.findFirst({
      where: { stateId, isLobby: true },
      select: { id: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.membership.upsert({
        where: {
          userId_nodeId: {
            userId: parsed.userId,
            nodeId: parsed.targetNodeId,
          },
        },
        create: {
          userId: parsed.userId,
          nodeId: parsed.targetNodeId,
          status: "active",
          title: parsed.title ?? null,
        },
        update: {
          status: "active",
          title: parsed.title ?? undefined,
        },
      });
      if (lobby) {
        await tx.membership
          .delete({
            where: {
              userId_nodeId: { userId: parsed.userId, nodeId: lobby.id },
            },
          })
          .catch(() => {});
      }
    });

    return NextResponse.json({ status: "admitted" }, { status: 200 });
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
