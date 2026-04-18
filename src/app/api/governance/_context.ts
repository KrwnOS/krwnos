/**
 * Shared helpers for `/api/governance/*` route handlers.
 *
 * CLI-bearer auth (тот же контракт, что у `/api/state/*` и
 * `/api/wallet/*`), загрузка VerticalSnapshot, сборка эффективных
 * прав пользователя через PermissionsEngine, конструирование
 * `GovernanceService`. Единожды — здесь, дальше все роуты тонкие.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { eventBus, permissionsEngine } from "@/core";
import {
  StateConfigService,
  createPrismaStateConfigRepository,
} from "@/core";
import {
  GovernanceError,
  GovernanceService,
  type GovernanceAccessContext,
} from "@/modules/governance";
import { createPrismaGovernanceRepository } from "@/modules/governance";
import type {
  PermissionKey,
  VerticalNode,
  VerticalSnapshot,
} from "@/types/kernel";
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

export interface GovernanceRouteContext {
  cli: CliAuthContext;
  stateId: string;
  service: GovernanceService;
  access: GovernanceAccessContext;
}

export function buildGovernanceService(): GovernanceService {
  return new GovernanceService({
    repo: createPrismaGovernanceRepository(prisma),
    stateConfig: new StateConfigService({
      repo: createPrismaStateConfigRepository(prisma),
      bus: eventBus,
    }),
    bus: eventBus,
  });
}

export async function loadGovernanceContext(
  req: NextRequest,
): Promise<GovernanceRouteContext> {
  const cli = await authenticateCli(req, cliLookup);
  if (!cli.stateId) {
    throw new GovernanceError(
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
      where: { node: { stateId }, status: "active" },
      select: { userId: true, nodeId: true },
    }),
  ]);

  if (!state) {
    throw new GovernanceError("State not found.", "not_found");
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

  const access: GovernanceAccessContext = {
    userId: cli.userId,
    isOwner,
    snapshot,
    permissions,
  };

  return {
    cli,
    stateId,
    service: buildGovernanceService(),
    access,
  };
}

export function governanceErrorResponse(err: unknown): NextResponse {
  if (err instanceof CliAuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof GovernanceError) {
    const status =
      err.code === "forbidden"
        ? 403
        : err.code === "not_found"
          ? 404
          : err.code === "conflict"
            ? 409
            : err.code === "closed"
              ? 410
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

/** JSON-safe serialiser (Date → ISO, BigInt → Number). */
export function serialiseForWire<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === "bigint") return Number(v);
      return v;
    }),
  );
}
