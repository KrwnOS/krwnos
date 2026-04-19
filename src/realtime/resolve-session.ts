/**
 * Build viewer context for WebSocket realtime (same rules as SSE routes).
 */
import { prisma } from "@/lib/prisma";
import {
  authenticateCli,
  CliAuthError,
  type CliAuthContext,
  type CliTokenLookup,
} from "@/app/api/cli/auth";
import type { ActivityViewerContext } from "@/core";

const cliLookup: CliTokenLookup = {
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

export interface RealtimeSession {
  cli: CliAuthContext;
  stateId: string;
  userId: string;
  isOwner: boolean;
  viewer: ActivityViewerContext;
}

/**
 * Authenticate raw CLI token (query string transport, same as SSE).
 */
export async function resolveRealtimeSession(
  rawToken: string,
): Promise<RealtimeSession> {
  const req = new Request(
    `http://krwn.ws/realtime?token=${encodeURIComponent(rawToken)}`,
  );
  const cli = await authenticateCli(req, cliLookup);
  if (!cli.stateId) {
    throw new CliAuthError("Token is not scoped to any State.");
  }
  const stateId = cli.stateId;

  const [state, nodes, memberships] = await Promise.all([
    prisma.state.findUnique({
      where: { id: stateId },
      select: { id: true, ownerId: true },
    }),
    prisma.verticalNode.findMany({
      where: { stateId },
      select: { id: true, parentId: true },
    }),
    prisma.membership.findMany({
      where: { node: { stateId }, userId: cli.userId, status: "active" },
      select: { nodeId: true },
    }),
  ]);

  if (!state) {
    throw new CliAuthError("State not found.", 403);
  }

  const parentOf = new Map<string, string | null>();
  for (const n of nodes) parentOf.set(n.id, n.parentId);

  const scope = new Set<string>();
  for (const m of memberships) {
    let cursor: string | null | undefined = m.nodeId;
    while (cursor) {
      if (scope.has(cursor)) break;
      scope.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
  }

  const isOwner = state.ownerId === cli.userId;
  const viewer: ActivityViewerContext = {
    userId: cli.userId,
    stateId,
    isOwner,
    scopeNodeIds: scope,
  };

  return {
    cli,
    stateId,
    userId: cli.userId,
    isOwner,
    viewer,
  };
}
