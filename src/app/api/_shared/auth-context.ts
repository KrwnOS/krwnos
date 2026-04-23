/**
 * Shared helpers for API route handlers that need authentication.
 *
 * Resolves the authenticated user (via CLI bearer token), loads a
 * `VerticalSnapshot` for the active State, derives the user's
 * effective permissions through the Permissions Engine, and assembles
 * a `ModuleContext` the service layer understands.
 *
 * This is the canonical pattern for API route authentication across
 * the platform. See `docs/MODULE_GUIDE.md#authentication-in-api-routes`
 * for details.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { eventBus, permissionsEngine } from "@/core";
import type { PermissionKey, VerticalNode, VerticalSnapshot } from "@/types/kernel";
import {
  authenticateCli,
  CliAuthError,
  type CliAuthContext,
} from "../cli/auth";
import { createNoopModuleLogger } from "@krwnos/sdk";
import type {
  ModuleContext,
  ModuleDatabase,
  ModuleSecretStore,
} from "@krwnos/sdk";

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

export interface AccessContext {
  isOwner: boolean;
  snapshot: VerticalSnapshot;
}

export interface AuthenticatedRouteContext {
  cli: CliAuthContext;
  ctx: ModuleContext;
  access: AccessContext;
  stateId: string;
}

export async function getAuthenticatedContext(
  req: NextRequest,
): Promise<AuthenticatedRouteContext> {
  const cli = await authenticateCli(req, cliLookup);
  if (!cli.stateId) {
    throw new CliAuthError(
      "Token is not scoped to any State.",
      401,
    );
  }
  const stateId = cli.stateId;

  const [state, nodes, memberships] = await Promise.all([
    prisma.state.findUnique({
      where: { id: stateId },
      select: { id: true, ownerId: true },
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
      where: { node: { stateId } },
      select: { userId: true, nodeId: true },
    }),
  ]);

  if (!state) {
    throw new CliAuthError("State not found.", 401);
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
  const permissions = permissionsEngine.resolveAll({
    stateId,
    userId: cli.userId,
    isOwner,
    snapshot,
  });

  const stubSecrets: ModuleSecretStore = {
    async get() {
      return null;
    },
  };
  const stubDb: ModuleDatabase = {
    async transaction(fn) {
      return fn({
        async queryRaw() {
          return [];
        },
        async executeRaw() {
          return 0;
        },
      });
    },
  };

  const ctx: ModuleContext = {
    stateId,
    userId: cli.userId,
    auth: { userId: cli.userId },
    permissions,
    bus: eventBus,
    logger: createNoopModuleLogger(),
    secrets: stubSecrets,
    db: stubDb,
  };

  return { cli, ctx, access: { isOwner, snapshot }, stateId };
}
