/**
 * Shared helpers for `/api/wallet/*` route handlers.
 *
 * Resolves the authenticated user (via CLI bearer token — same
 * transport as `/api/chat/*`), loads a `VerticalSnapshot` for the
 * active State, derives the user's effective permissions through
 * the Permissions Engine, and assembles a `WalletAccessContext`
 * that the `WalletService` understands.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  WalletAccessError,
  WalletCoreService,
  createPrismaWalletRepository,
  type WalletAccessContext,
} from "@/modules/wallet";
import { eventBus, permissionsEngine } from "@/core";
import type { PermissionKey, VerticalNode, VerticalSnapshot } from "@/types/kernel";
import {
  authenticateCli,
  CliAuthError,
  type CliAuthContext,
} from "../cli/auth";
// Side-effect import: ensures the Activity Feed subscriber is wired to the
// Event Bus before any wallet event is emitted in this process.
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

export interface WalletRouteContext {
  cli: CliAuthContext;
  stateId: string;
  service: WalletCoreService;
  access: WalletAccessContext;
}

export function buildWalletService(): WalletCoreService {
  return new WalletCoreService({
    repo: createPrismaWalletRepository(prisma),
    bus: eventBus,
  });
}

export async function loadWalletContext(
  req: NextRequest,
): Promise<WalletRouteContext> {
  const cli = await authenticateCli(req, cliLookup);
  if (!cli.stateId) {
    throw new WalletAccessError(
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
    throw new WalletAccessError("State not found.", "not_found");
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

  const access: WalletAccessContext = {
    userId: cli.userId,
    isOwner,
    snapshot,
    permissions: held,
  };

  return { cli, stateId, service: buildWalletService(), access };
}

export function walletErrorResponse(err: unknown): NextResponse {
  if (err instanceof CliAuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof WalletAccessError) {
    const status =
      err.code === "forbidden"
        ? 403
        : err.code === "not_found"
          ? 404
          : err.code === "insufficient_funds"
            ? 409
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

/**
 * JSON-safe serialiser: `Date` → ISO string. Balances/amounts are
 * plain `Float`s so they need no special handling. Kept as a single
 * funnel so future types (e.g. `Decimal`) can be massaged here.
 */
export function serialiseForWire<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === "bigint") return Number(v);
      return v;
    }),
  );
}
