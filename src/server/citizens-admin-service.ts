/**
 * Citizen administration — Prisma + Event Bus. Permission checks stay in
 * `citizens-admin-logic`; routes call both.
 */

import { randomBytes } from "node:crypto";
import { Decimal } from "@prisma/client/runtime/library";
import { eventBus, KernelEvents } from "@/core";
import {
  canAdmitToNode,
  canBanOrMerge,
  canEditTitleOnNode,
  canKickOnNode,
  canMoveFromNode,
  canMoveToNode,
} from "@/core/citizens-admin-logic";
import { MembershipAdminPermissions } from "@/core/membership-admin-permissions";
import type { StateConfigAccessContext } from "@/core/state-config";
import type { VerticalSnapshot } from "@/types/kernel";
import { prisma } from "@/lib/prisma";
import { bannedUserIdsInState } from "@/server/state-ban";

export class CitizensAdminError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "forbidden"
      | "not_found"
      | "invalid_input"
      | "conflict"
      | "merge_blocked",
  ) {
    super(message);
    this.name = "CitizensAdminError";
  }
}

export interface ListCitizensInput {
  stateId: string;
  nodeId?: string | null;
  status?: "active" | "pending" | "all";
  q?: string;
  limit?: number;
}

export interface CitizenRow {
  userId: string;
  handle: string;
  displayName: string | null;
  nodeId: string;
  nodeTitle: string;
  isLobby: boolean;
  title: string | null;
  status: "active" | "pending";
  banned: boolean;
}

export async function listCitizens(input: ListCitizensInput): Promise<CitizenRow[]> {
  const limit = Math.min(200, Math.max(1, input.limit ?? 80));
  const status =
    input.status === "active" || input.status === "pending"
      ? input.status
      : undefined;

  const rows = await prisma.membership.findMany({
    where: {
      node: { stateId: input.stateId },
      ...(input.nodeId ? { nodeId: input.nodeId } : {}),
      ...(status ? { status } : {}),
      ...(input.q?.trim()
        ? {
            user: {
              OR: [
                { handle: { contains: input.q.trim(), mode: "insensitive" } },
                { displayName: { contains: input.q.trim(), mode: "insensitive" } },
              ],
            },
          }
        : {}),
    },
    take: limit,
    orderBy: [{ updatedAt: "desc" }],
    select: {
      userId: true,
      title: true,
      status: true,
      nodeId: true,
      user: { select: { handle: true, displayName: true } },
      node: { select: { title: true, isLobby: true } },
    },
  });

  const bannedIds = await bannedUserIdsInState(
    input.stateId,
    [...new Set(rows.map((r) => r.userId))],
  );

  return rows.map((r) => ({
    userId: r.userId,
    handle: r.user.handle,
    displayName: r.user.displayName,
    nodeId: r.nodeId,
    nodeTitle: r.node.title,
    isLobby: r.node.isLobby,
    title: r.title,
    status: r.status,
    banned: bannedIds.has(r.userId),
  }));
}

async function ensureMembershipRow(
  stateId: string,
  userId: string,
  nodeId: string,
) {
  const m = await prisma.membership.findUnique({
    where: { userId_nodeId: { userId, nodeId } },
    include: { node: { select: { stateId: true } } },
  });
  if (!m || m.node.stateId !== stateId) {
    throw new CitizensAdminError("Membership not found in this state.", "not_found");
  }
  return m;
}

export async function kickMembership(input: {
  stateId: string;
  access: StateConfigAccessContext;
  snapshot: VerticalSnapshot;
  userId: string;
  nodeId: string;
}): Promise<void> {
  const m = await ensureMembershipRow(input.stateId, input.userId, input.nodeId);
  if (!canKickOnNode(input.stateId, input.access, input.snapshot, input.nodeId)) {
    throw new CitizensAdminError("Missing members.kick for this node.", "forbidden");
  }
  await prisma.membership.delete({
    where: { userId_nodeId: { userId: input.userId, nodeId: input.nodeId } },
  });
  await eventBus.emit(KernelEvents.MembershipRevoked, {
    stateId: input.stateId,
    userId: input.userId,
    nodeId: input.nodeId,
    actorId: input.access.userId,
  });
}

export async function banUser(input: {
  stateId: string;
  access: StateConfigAccessContext;
  snapshot: VerticalSnapshot;
  userId: string;
  reason?: string | null;
}): Promise<void> {
  if (!canBanOrMerge(input.stateId, input.access, input.snapshot, MembershipAdminPermissions.Ban)) {
    throw new CitizensAdminError("Only the sovereign may ban citizens.", "forbidden");
  }
  const state = await prisma.state.findUnique({
    where: { id: input.stateId },
    select: { ownerId: true },
  });
  if (!state) throw new CitizensAdminError("State not found.", "not_found");
  if (state.ownerId === input.userId) {
    throw new CitizensAdminError("Cannot ban the sovereign.", "invalid_input");
  }

  await prisma.$transaction(async (tx) => {
    await tx.membership.deleteMany({
      where: { userId: input.userId, node: { stateId: input.stateId } },
    });
    const banId = `ban_${randomBytes(12).toString("hex")}`;
    await tx.$executeRaw`
      INSERT INTO "StateUserBan" ("id", "stateId", "userId", "reason", "createdAt", "createdById", "revokedAt")
      VALUES (
        ${banId},
        ${input.stateId},
        ${input.userId},
        ${input.reason ?? null},
        NOW(),
        ${input.access.userId},
        NULL
      )
      ON CONFLICT ("stateId", "userId") DO UPDATE SET
        "reason" = EXCLUDED."reason",
        "revokedAt" = NULL,
        "createdById" = EXCLUDED."createdById"
    `;
  });

  await eventBus.emit(KernelEvents.UserBannedInState, {
    stateId: input.stateId,
    userId: input.userId,
    actorId: input.access.userId,
    reason: input.reason ?? null,
  });
}

export async function unbanUser(input: {
  stateId: string;
  access: StateConfigAccessContext;
  snapshot: VerticalSnapshot;
  userId: string;
}): Promise<void> {
  if (!canBanOrMerge(input.stateId, input.access, input.snapshot, MembershipAdminPermissions.Ban)) {
    throw new CitizensAdminError("Only the sovereign may unban citizens.", "forbidden");
  }
  await prisma.$executeRaw`
    UPDATE "StateUserBan"
    SET "revokedAt" = NOW()
    WHERE "stateId" = ${input.stateId}
      AND "userId" = ${input.userId}
      AND "revokedAt" IS NULL
  `;
  await eventBus.emit(KernelEvents.UserUnbannedInState, {
    stateId: input.stateId,
    userId: input.userId,
    actorId: input.access.userId,
  });
}

export async function moveMembership(input: {
  stateId: string;
  access: StateConfigAccessContext;
  snapshot: VerticalSnapshot;
  userId: string;
  fromNodeId: string;
  toNodeId: string;
  title?: string | null;
}): Promise<void> {
  if (input.fromNodeId === input.toNodeId) {
    throw new CitizensAdminError("fromNodeId and toNodeId must differ.", "invalid_input");
  }
  if (
    !canMoveFromNode(input.stateId, input.access, input.snapshot, input.fromNodeId) ||
    !canMoveToNode(input.stateId, input.access, input.snapshot, input.toNodeId)
  ) {
    throw new CitizensAdminError("Missing members.move / invitations.create on both ends.", "forbidden");
  }

  const [fromNode, toNode] = await Promise.all([
    prisma.verticalNode.findUnique({
      where: { id: input.fromNodeId },
      select: { stateId: true, isLobby: true },
    }),
    prisma.verticalNode.findUnique({
      where: { id: input.toNodeId },
      select: { stateId: true, isLobby: true },
    }),
  ]);
  if (!fromNode || !toNode || fromNode.stateId !== input.stateId || toNode.stateId !== input.stateId) {
    throw new CitizensAdminError("Node not found in this state.", "not_found");
  }
  if (toNode.isLobby) {
    throw new CitizensAdminError("Cannot move someone into the Waiting Room.", "invalid_input");
  }

  await ensureMembershipRow(input.stateId, input.userId, input.fromNodeId);

  await prisma.$transaction(async (tx) => {
    await tx.membership.delete({
      where: {
        userId_nodeId: { userId: input.userId, nodeId: input.fromNodeId },
      },
    });
    await tx.membership.upsert({
      where: {
        userId_nodeId: { userId: input.userId, nodeId: input.toNodeId },
      },
      create: {
        userId: input.userId,
        nodeId: input.toNodeId,
        status: "active",
        title: input.title ?? null,
      },
      update: {
        status: "active",
        title: input.title ?? undefined,
      },
    });
  });

  await eventBus.emit(KernelEvents.MembershipMoved, {
    stateId: input.stateId,
    userId: input.userId,
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
    actorId: input.access.userId,
  });
}

export async function admitUser(input: {
  stateId: string;
  access: StateConfigAccessContext;
  snapshot: VerticalSnapshot;
  userId: string;
  targetNodeId: string;
  title?: string | null;
}): Promise<void> {
  if (!canAdmitToNode(input.stateId, input.access, input.snapshot, input.targetNodeId)) {
    throw new CitizensAdminError("Missing invitations.create for this node.", "forbidden");
  }

  const targetNode = await prisma.verticalNode.findUnique({
    where: { id: input.targetNodeId },
    select: { stateId: true, isLobby: true },
  });
  if (!targetNode || targetNode.stateId !== input.stateId) {
    throw new CitizensAdminError("Target node not found.", "not_found");
  }
  if (targetNode.isLobby) {
    throw new CitizensAdminError("Cannot admit into the Waiting Room.", "invalid_input");
  }

  const lobby = await prisma.verticalNode.findFirst({
    where: { stateId: input.stateId, isLobby: true },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.membership.upsert({
      where: {
        userId_nodeId: { userId: input.userId, nodeId: input.targetNodeId },
      },
      create: {
        userId: input.userId,
        nodeId: input.targetNodeId,
        status: "active",
        title: input.title ?? null,
      },
      update: {
        status: "active",
        title: input.title ?? undefined,
      },
    });
    if (lobby) {
      await tx.membership
        .delete({
          where: {
            userId_nodeId: { userId: input.userId, nodeId: lobby.id },
          },
        })
        .catch(() => {});
    }
  });

  await eventBus.emit(KernelEvents.MembershipGranted, {
    stateId: input.stateId,
    userId: input.userId,
    nodeId: input.targetNodeId,
    actorId: input.access.userId,
  });
}

export async function updateMembershipTitle(input: {
  stateId: string;
  access: StateConfigAccessContext;
  snapshot: VerticalSnapshot;
  userId: string;
  nodeId: string;
  title: string | null;
}): Promise<void> {
  if (!canEditTitleOnNode(input.stateId, input.access, input.snapshot, input.nodeId)) {
    throw new CitizensAdminError("Missing members.edit_title for this node.", "forbidden");
  }
  await ensureMembershipRow(input.stateId, input.userId, input.nodeId);
  await prisma.membership.update({
    where: { userId_nodeId: { userId: input.userId, nodeId: input.nodeId } },
    data: { title: input.title },
  });
}

export async function mergeUsers(input: {
  stateId: string;
  access: StateConfigAccessContext;
  snapshot: VerticalSnapshot;
  sourceUserId: string;
  targetUserId: string;
}): Promise<{ status: "merged" | "already_merged" }> {
  if (!canBanOrMerge(input.stateId, input.access, input.snapshot, MembershipAdminPermissions.Merge)) {
    throw new CitizensAdminError("Only the sovereign may merge users.", "forbidden");
  }
  if (input.sourceUserId === input.targetUserId) {
    throw new CitizensAdminError("source and target must differ.", "invalid_input");
  }

  const source = await prisma.user.findUnique({
    where: { id: input.sourceUserId },
    select: {
      id: true,
      ownedStates: { select: { id: true }, take: 1 },
    },
  });
  if (!source) return { status: "already_merged" };

  const target = await prisma.user.findUnique({
    where: { id: input.targetUserId },
    select: { id: true },
  });
  if (!target) throw new CitizensAdminError("Target user not found.", "not_found");

  const state = await prisma.state.findUnique({
    where: { id: input.stateId },
    select: { ownerId: true },
  });
  if (!state) throw new CitizensAdminError("State not found.", "not_found");
  if (state.ownerId === input.sourceUserId || state.ownerId === input.targetUserId) {
    throw new CitizensAdminError("Cannot merge sovereign accounts.", "merge_blocked");
  }
  if (source.ownedStates.length > 0) {
    throw new CitizensAdminError("Source user owns a state; merge blocked.", "merge_blocked");
  }

  const sourceInState = await prisma.membership.findFirst({
    where: { userId: input.sourceUserId, node: { stateId: input.stateId } },
    select: { id: true },
  });
  const targetInState = await prisma.membership.findFirst({
    where: { userId: input.targetUserId, node: { stateId: input.stateId } },
    select: { id: true },
  });
  if (!sourceInState || !targetInState) {
    throw new CitizensAdminError("Both users must have membership in this state.", "invalid_input");
  }

  const sourceId = input.sourceUserId;
  const targetId = input.targetUserId;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      DELETE FROM "Vote" v
      USING "Vote" t
      WHERE v."userId" = ${sourceId}
        AND t."userId" = ${targetId}
        AND v."proposalId" = t."proposalId"
    `;

    await tx.vote.updateMany({
      where: { userId: sourceId },
      data: { userId: targetId },
    });

    await tx.$executeRaw`
      DELETE FROM "ChatDirectiveAck" a
      USING "ChatDirectiveAck" b
      WHERE a."userId" = ${sourceId}
        AND b."userId" = ${targetId}
        AND a."messageId" = b."messageId"
    `;

    await tx.chatDirectiveAck.updateMany({
      where: { userId: sourceId },
      data: { userId: targetId },
    });

    await tx.chatMessage.updateMany({
      where: { authorId: sourceId },
      data: { authorId: targetId },
    });

    await tx.proposal.updateMany({
      where: { createdById: sourceId },
      data: { createdById: targetId },
    });
    await tx.proposal.updateMany({
      where: { executedById: sourceId },
      data: { executedById: targetId },
    });
    await tx.proposal.updateMany({
      where: { vetoedById: sourceId },
      data: { vetoedById: targetId },
    });

    await tx.transaction.updateMany({
      where: { initiatedById: sourceId },
      data: { initiatedById: targetId },
    });

    await tx.invitation.updateMany({
      where: { createdById: sourceId },
      data: { createdById: targetId },
    });

    await tx.exchangePair.updateMany({
      where: { createdById: sourceId },
      data: { createdById: targetId },
    });

    await tx.crossStateTransaction.updateMany({
      where: { initiatedById: sourceId },
      data: { initiatedById: targetId },
    });

    await tx.activityLog.updateMany({
      where: { actorId: sourceId },
      data: { actorId: targetId },
    });

    const sourceCharges = await tx.roleTaxPeriodCharge.findMany({
      where: { userId: sourceId },
    });
    for (const ch of sourceCharges) {
      const existing = await tx.roleTaxPeriodCharge.findUnique({
        where: {
          stateId_userId_periodKey: {
            stateId: ch.stateId,
            userId: targetId,
            periodKey: ch.periodKey,
          },
        },
      });
      if (existing) {
        await tx.roleTaxPeriodCharge.update({
          where: { id: existing.id },
          data: {
            amount: existing.amount.add(ch.amount),
          },
        });
        await tx.roleTaxPeriodCharge.delete({ where: { id: ch.id } });
      } else {
        await tx.roleTaxPeriodCharge.update({
          where: { id: ch.id },
          data: { userId: targetId },
        });
      }
    }

    const sourceMemberships = await tx.membership.findMany({
      where: { userId: sourceId },
    });
    for (const sm of sourceMemberships) {
      const dup = await tx.membership.findUnique({
        where: {
          userId_nodeId: { userId: targetId, nodeId: sm.nodeId },
        },
      });
      if (dup) {
        await tx.membership.delete({ where: { id: sm.id } });
      } else {
        await tx.membership.update({
          where: { id: sm.id },
          data: { userId: targetId },
        });
      }
    }

    const sourceWallets = await tx.wallet.findMany({
      where: { userId: sourceId, type: "PERSONAL" },
    });
    for (const w of sourceWallets) {
      const peer = await tx.wallet.findFirst({
        where: {
          stateId: w.stateId,
          userId: targetId,
          type: "PERSONAL",
          ...(w.assetId == null ? { assetId: null } : { assetId: w.assetId }),
        },
      });
      if (peer) {
        await tx.wallet.update({
          where: { id: peer.id },
          data: {
            balance: peer.balance.add(w.balance as Decimal),
          },
        });
        await tx.wallet.delete({ where: { id: w.id } });
      } else {
        await tx.wallet.update({
          where: { id: w.id },
          data: { userId: targetId },
        });
      }
    }

    await tx.cliToken.updateMany({
      where: { userId: sourceId },
      data: { userId: targetId },
    });

    await tx.$executeRaw`
      DELETE FROM "StateUserBan" WHERE "userId" = ${sourceId}
    `;

    const creds = await tx.authCredential.findMany({ where: { userId: sourceId } });
    for (const c of creds) {
      const clash = await tx.authCredential.findFirst({
        where: { kind: c.kind, identifier: c.identifier, userId: { not: sourceId } },
      });
      if (clash) {
        await tx.authCredential.delete({ where: { id: c.id } });
      } else {
        await tx.authCredential.update({
          where: { id: c.id },
          data: { userId: targetId },
        });
      }
    }

    await tx.user.delete({ where: { id: sourceId } });
  });

  await eventBus.emit(KernelEvents.UsersMergedInState, {
    stateId: input.stateId,
    sourceUserId: sourceId,
    targetUserId: targetId,
    actorId: input.access.userId,
  });

  return { status: "merged" };
}
