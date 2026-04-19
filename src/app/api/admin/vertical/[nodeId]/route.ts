/**
 * `/api/admin/vertical/[nodeId]` — mutate a single Vertical node.
 * ------------------------------------------------------------
 * PATCH  — partial update. Supports re-parenting (drag-and-drop in
 *          the editor), title / type / permissions / order edits.
 * DELETE — cascade removal. Prisma takes care of descendants via
 *          `onDelete: SetNull` on the self-relation — дочерние
 *          узлы становятся корневыми, а не исчезают. Это сознательно:
 *          удалять целое министерство одной кнопкой слишком опасно.
 *
 * Auth gate matches `/api/admin/vertical` (POST/GET): Sovereign
 * либо держатель `system.admin` / `system.*` / `*`.
 *
 * Cycle protection: при смене parent`а мы проверяем, что
 * candidate parent не лежит в потомках текущего узла, иначе
 * получим «узел сам себе предок».
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  canAccessVerticalAdmin,
  loadStateContext,
  stateErrorResponse,
} from "../../../state/_context";

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    type: z.enum(["position", "department", "rank"]).optional(),
    permissions: z.array(z.string().trim().min(1).max(120)).optional(),
    parentId: z.string().trim().min(1).nullable().optional(),
    order: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

export async function PATCH(
  req: NextRequest,
  { params }: { params: { nodeId: string } },
) {
  try {
    const { stateId, access, snapshot } = await loadStateContext(req);
    if (!canAccessVerticalAdmin(stateId, access, snapshot)) {
      return forbidden();
    }

    const body = patchSchema.parse(await req.json());
    const nodeId = params.nodeId;

    const node = await prisma.verticalNode.findUnique({
      where: { id: nodeId },
      select: { id: true, stateId: true, parentId: true },
    });
    if (!node || node.stateId !== stateId) {
      return NextResponse.json(
        { error: "Node not found", code: "not_found" },
        { status: 404 },
      );
    }

    const data: Record<string, unknown> = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.type !== undefined) data.type = body.type;
    if (body.permissions !== undefined) data.permissions = body.permissions;
    if (body.order !== undefined) data.order = body.order;

    if (body.parentId !== undefined) {
      const nextParent = body.parentId;
      if (nextParent === nodeId) {
        return badRequest("A node cannot be its own parent");
      }
      if (nextParent === null) {
        data.parentId = null;
      } else {
        const candidate = await prisma.verticalNode.findUnique({
          where: { id: nextParent },
          select: { id: true, stateId: true },
        });
        if (!candidate || candidate.stateId !== stateId) {
          return badRequest("parentId does not belong to this State");
        }
        if (await wouldCreateCycle(nodeId, nextParent)) {
          return badRequest("Cannot move a node under its own descendant");
        }
        data.parentId = nextParent;
      }
    }

    const updated = await prisma.verticalNode.update({
      where: { id: nodeId },
      data,
    });

    return NextResponse.json({
      node: {
        ...updated,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    return stateErrorResponse(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { nodeId: string } },
) {
  try {
    const { stateId, access, snapshot } = await loadStateContext(req);
    if (!canAccessVerticalAdmin(stateId, access, snapshot)) {
      return forbidden();
    }

    const nodeId = params.nodeId;
    const node = await prisma.verticalNode.findUnique({
      where: { id: nodeId },
      select: { id: true, stateId: true, isLobby: true },
    });
    if (!node || node.stateId !== stateId) {
      return NextResponse.json(
        { error: "Node not found", code: "not_found" },
        { status: 404 },
      );
    }
    if (node.isLobby) {
      return badRequest("Lobby node cannot be deleted — demote it first");
    }

    await prisma.verticalNode.delete({ where: { id: nodeId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return stateErrorResponse(err);
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

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
  return NextResponse.json(
    { error: msg, code: "invalid_input" },
    { status: 400 },
  );
}

/**
 * Walk upwards from `candidateParentId` — if we hit `nodeId`,
 * the reparent would create a cycle (moving a node under its
 * own descendant).
 */
async function wouldCreateCycle(
  nodeId: string,
  candidateParentId: string,
): Promise<boolean> {
  let cursor: string | null = candidateParentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === nodeId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    const row: { parentId: string | null } | null =
      await prisma.verticalNode.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
    cursor = row?.parentId ?? null;
  }
  return false;
}
