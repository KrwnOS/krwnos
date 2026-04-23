/**
 * Shared helpers for `/api/chat/*` route handlers.
 *
 * Resolves the authenticated user (via CLI bearer token), loads a
 * `VerticalSnapshot` for the active State, derives the user's
 * effective permissions through the Permissions Engine, and assembles
 * a `ChatAccessContext` the `ChatService` understands.
 *
 * Keeping this behind a tiny helper avoids duplicating 30 lines of
 * boilerplate in every handler.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  ChatAccessError,
  ChatService,
  createPrismaChatRepository,
} from "@/modules/chat";
import { eventBus, permissionsEngine } from "@/core";
import type { PermissionKey, VerticalNode, VerticalSnapshot } from "@/types/kernel";
import {
  authenticateCli,
  CliAuthError,
  type CliAuthContext,
} from "../cli/auth";
import type { ChatAccessContext } from "@/modules/chat";
// Side-effect import: ensures the Activity Feed subscriber is wired to the
// Event Bus before any chat event is emitted in this process.
import "@/server/activity-boot";

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

export interface ChatRouteContext {
  cli: CliAuthContext;
  stateId: string;
  service: ChatService;
  access: ChatAccessContext;
}

/** Built once per route invocation; avoids exporting the service globally. */
export function buildChatService(): ChatService {
  return new ChatService({
    repo: createPrismaChatRepository(prisma),
    bus: eventBus,
  });
}

export async function loadChatContext(
  req: NextRequest,
): Promise<ChatRouteContext> {
  const cli = await authenticateCli(req, cliLookup);
  if (!cli.stateId) {
    throw new ChatAccessError(
      "Token is not scoped to any State.",
      "invalid_input",
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
    throw new ChatAccessError("State not found.", "not_found");
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
  const held = permissionsEngine.resolveAll({
    stateId,
    userId: cli.userId,
    isOwner,
    snapshot,
  });

  const access: ChatAccessContext = {
    userId: cli.userId,
    isOwner,
    snapshot,
    permissions: held,
  };

  return { cli, stateId, service: buildChatService(), access };
}

export function chatErrorResponse(err: unknown): NextResponse {
  if (err instanceof CliAuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof ChatAccessError) {
    const status =
      err.code === "forbidden"
        ? 403
        : err.code === "not_found"
          ? 404
          : 400;
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status },
    );
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: err.issues }, { status: 400 });
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : "internal error" },
    { status: 500 },
  );
}

// ---------------------------------------------------------------------------
// DEPRECATED: Use @/app/api/_shared/auth-context instead
// ---------------------------------------------------------------------------
// Re-exported here for backward compatibility. Chat routes should migrate
// to use the shared helper directly. S1.2 introduced the shared helper;
// S1.3 and beyond will migrate all routes to the shared pattern.

import {
  getAuthenticatedContext as _sharedGetAuthenticatedContext,
  type AuthenticatedRouteContext,
  type AccessContext,
} from "../_shared/auth-context";
import type {
  ModuleContext,
} from "@krwnos/sdk";

/**
 * @deprecated Use `@/app/api/_shared/auth-context#getAuthenticatedContext` instead.
 *
 * This is a compatibility shim. It wraps the shared helper and adapts
 * the return type for backward compatibility with existing tasks routes.
 */
export async function getAuthenticatedContext(
  req: NextRequest,
): Promise<{ ctx: ModuleContext; access: AccessContext }> {
  const result = await _sharedGetAuthenticatedContext(req);
  return { ctx: result.ctx, access: result.access };
}
