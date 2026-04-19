/**
 * `/api/admin/vertical` — tree CRUD for the Vertical Builder UI.
 * ------------------------------------------------------------
 * Sibling of `/api/admin/nexus` and `/api/cli/vertical`. The Nexus
 * endpoint is read-only (just a count) and the CLI endpoint is
 * scoped to raw `vertical.read` / `vertical.write` scopes a CLI
 * token carries. Here we need a *UI*-friendly, Sovereign-gated
 * contract so that the Visual Builder page at
 * `/admin/vertical-editor` can render and mutate the full tree
 * without worrying about scope plumbing.
 *
 * Auth gate mirrors `/api/admin/nexus`:
 *   * Sovereign (isOwner) always passes.
 *   * Holders of `*`, `system.admin` or `system.*` pass.
 *   * Everyone else — 403. The UI then redirects to the citizen
 *     feed at `/`.
 *
 * GET  /api/admin/vertical
 *   -> { nodes: NodeDto[], memberCounts: Record<nodeId, number> }
 *
 * POST /api/admin/vertical  { title, parentId?, type?, permissions? }
 *   -> { node: NodeDto }     (201)
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { PermissionKey } from "@/types/kernel";
import { loadStateContext, stateErrorResponse } from "../../state/_context";

const ADMIN_PERMISSION: PermissionKey = "system.admin";

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  parentId: z.string().trim().min(1).nullable().optional(),
  type: z.enum(["position", "department", "rank"]).default("position"),
  permissions: z.array(z.string().trim().min(1).max(120)).optional(),
});

export interface VerticalNodeDto {
  id: string;
  stateId: string;
  parentId: string | null;
  title: string;
  type: "position" | "department" | "rank";
  permissions: string[];
  order: number;
  isLobby: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function GET(req: NextRequest) {
  try {
    const { stateId, access } = await loadStateContext(req);
    if (!canManageVertical(access.isOwner, access.permissions)) {
      return forbidden();
    }

    const [nodes, membershipGroups] = await Promise.all([
      prisma.verticalNode.findMany({
        where: { stateId },
        orderBy: [{ parentId: "asc" }, { order: "asc" }, { createdAt: "asc" }],
      }),
      prisma.membership.groupBy({
        by: ["nodeId"],
        where: { node: { stateId }, status: "active" },
        _count: { nodeId: true },
      }),
    ]);

    const memberCounts: Record<string, number> = {};
    for (const row of membershipGroups) {
      memberCounts[row.nodeId] = row._count.nodeId;
    }

    return NextResponse.json({
      nodes: nodes.map(toDto),
      memberCounts,
    });
  } catch (err) {
    return stateErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { stateId, access } = await loadStateContext(req);
    if (!canManageVertical(access.isOwner, access.permissions)) {
      return forbidden();
    }

    const body = createSchema.parse(await req.json());
    const parentId = body.parentId ?? null;

    if (parentId) {
      const parent = await prisma.verticalNode.findUnique({
        where: { id: parentId },
        select: { stateId: true },
      });
      if (!parent || parent.stateId !== stateId) {
        return badRequest("parentId does not belong to this State");
      }
    }

    const maxOrder = await prisma.verticalNode.aggregate({
      where: { stateId, parentId },
      _max: { order: true },
    });

    const created = await prisma.verticalNode.create({
      data: {
        stateId,
        parentId,
        title: body.title,
        type: body.type,
        permissions: body.permissions ?? [],
        order: (maxOrder._max.order ?? 0) + 1,
      },
    });

    return NextResponse.json({ node: toDto(created) }, { status: 201 });
  } catch (err) {
    return stateErrorResponse(err);
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function canManageVertical(
  isOwner: boolean,
  held: ReadonlySet<PermissionKey>,
): boolean {
  if (isOwner) return true;
  if (held.has("*")) return true;
  if (held.has(ADMIN_PERMISSION)) return true;
  if (held.has("system.*" as PermissionKey)) return true;
  return false;
}

function forbidden() {
  return NextResponse.json(
    {
      error:
        "Vertical editor доступен только Суверену или держателю system.admin.",
      code: "forbidden",
    },
    { status: 403 },
  );
}

function badRequest(msg: string) {
  return NextResponse.json({ error: msg, code: "invalid_input" }, { status: 400 });
}

function toDto(row: {
  id: string;
  stateId: string;
  parentId: string | null;
  title: string;
  type: "position" | "department" | "rank";
  permissions: string[];
  order: number;
  isLobby: boolean;
  createdAt: Date;
  updatedAt: Date;
}): VerticalNodeDto {
  return {
    id: row.id,
    stateId: row.stateId,
    parentId: row.parentId,
    title: row.title,
    type: row.type,
    permissions: row.permissions,
    order: row.order,
    isLobby: row.isLobby,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
