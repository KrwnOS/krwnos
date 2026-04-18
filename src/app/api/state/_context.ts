/**
 * Shared helpers for `/api/state/*` route handlers.
 *
 * Палата Указов и другие «государственные» endpoints разделяют
 * общий контекст: CLI-bearer auth, загрузка VerticalSnapshot,
 * расчёт эффективных прав через PermissionsEngine.
 *
 * Специально отдельный файл (а не переиспользование
 * `/api/wallet/_context.ts`) — чтобы state-роуты не тянули за
 * собой `WalletCoreService`, а сами stayed минимальными.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { eventBus, permissionsEngine } from "@/core";
import {
  StateConfigError,
  StateConfigService,
  createPrismaStateConfigRepository,
  type StateConfigAccessContext,
} from "@/core";
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

export interface StateRouteContext {
  cli: CliAuthContext;
  stateId: string;
  service: StateConfigService;
  access: StateConfigAccessContext;
}

export function buildStateConfigService(): StateConfigService {
  return new StateConfigService({
    repo: createPrismaStateConfigRepository(prisma),
    bus: eventBus,
  });
}

export async function loadStateContext(
  req: NextRequest,
): Promise<StateRouteContext> {
  const cli = await authenticateCli(req, cliLookup);
  if (!cli.stateId) {
    throw new StateConfigError(
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
    throw new StateConfigError("State not found.", "not_found");
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

  const access: StateConfigAccessContext = {
    userId: cli.userId,
    isOwner,
    permissions: held,
  };

  return { cli, stateId, service: buildStateConfigService(), access };
}

export function stateErrorResponse(err: unknown): NextResponse {
  if (err instanceof CliAuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof StateConfigError) {
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

/** JSON-safe serialiser (BigInt → Number, Date → ISO via JSON.stringify). */
export function serialiseForWire<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === "bigint") return Number(v);
      return v;
    }),
  );
}
