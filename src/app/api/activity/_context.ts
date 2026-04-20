/**
 * Shared helpers for `/api/activity/*` route handlers.
 *
 * Resolves the authenticated user (CLI bearer token — same transport
 * as /api/chat/*, /api/wallet/*), builds the viewer's "node scope"
 * (every node they're a member of, plus all ancestors of those
 * nodes), and returns a ready `ActivityViewerContext` that the
 * `ActivityFeedService.listForViewer()` uses for visibility filtering.
 *
 * The scope is built in-memory from the full Vertical instead of
 * recursively walking the tree per-row — ленту смотрят часто, а
 * Vertical у государства обычно небольшой (десятки-сотни узлов).
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  permissionsEngine,
  type ActivityFeedService,
  type ActivityViewerContext,
} from "@/core";
import { getActivityFeed } from "@/server/activity-boot";
import type { PermissionKey, VerticalNode, VerticalSnapshot } from "@/types/kernel";
import {
  authenticateCli,
  CliAuthError,
  type CliAuthContext,
} from "../cli/auth";

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

export class ActivityAccessError extends Error {
  constructor(
    message: string,
    public readonly code: "forbidden" | "not_found" | "invalid_input",
  ) {
    super(message);
    this.name = "ActivityAccessError";
  }
}

export interface ActivityRouteContext {
  cli: CliAuthContext;
  stateId: string;
  service: ActivityFeedService;
  viewer: ActivityViewerContext;
  /** Sovereign or effective `system.admin` — can use `audit=1` (full log). */
  canSeeFullAuditLog: boolean;
}

export async function loadActivityContext(
  req: NextRequest,
): Promise<ActivityRouteContext> {
  const cli = await authenticateCli(req, cliLookup);
  if (!cli.stateId) {
    throw new ActivityAccessError(
      "Token is not scoped to any State.",
      "invalid_input",
    );
  }
  const stateId = cli.stateId;

  const [state, nodes, memberships, membershipsForSnapshot] = await Promise.all([
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
      where: { node: { stateId }, userId: cli.userId, status: "active" },
      select: { nodeId: true },
    }),
    prisma.membership.findMany({
      where: { node: { stateId }, status: "active" },
      select: { userId: true, nodeId: true },
    }),
  ]);

  if (!state) {
    throw new ActivityAccessError("State not found.", "not_found");
  }

  const isOwner = state.ownerId === cli.userId;

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
  for (const m of membershipsForSnapshot) {
    let set = snapshot.membershipsByUser.get(m.userId);
    if (!set) {
      set = new Set();
      snapshot.membershipsByUser.set(m.userId, set);
    }
    set.add(m.nodeId);
  }

  const canSeeFullAuditLog = isOwner
    ? true
    : permissionsEngine.can(
        {
          stateId,
          userId: cli.userId,
          isOwner,
          snapshot,
        },
        "system.admin",
      );

  // Build a parentId index so `walkAncestors` is O(depth) per node.
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

  const viewer: ActivityViewerContext = {
    userId: cli.userId,
    stateId,
    isOwner,
    scopeNodeIds: scope,
  };

  return {
    cli,
    stateId,
    service: getActivityFeed(),
    viewer,
    canSeeFullAuditLog,
  };
}

export function activityErrorResponse(err: unknown): NextResponse {
  if (err instanceof CliAuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof ActivityAccessError) {
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
  return NextResponse.json(
    { error: err instanceof Error ? err.message : "internal error" },
    { status: 500 },
  );
}

export function serialiseEntry<T extends { createdAt: Date }>(entry: T): unknown {
  return JSON.parse(
    JSON.stringify(entry, (_k, v) => {
      if (typeof v === "bigint") return Number(v);
      return v;
    }),
  );
}
