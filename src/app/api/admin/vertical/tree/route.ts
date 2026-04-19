/**
 * PUT /api/admin/vertical/tree — atomically apply parentId + order for
 * all Vertical nodes in the State (drag-and-drop save).
 *
 * Auth: `canAccessVerticalAdmin` → permissionsEngine.can(system.admin).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  sortForStructuralApply,
  validateProposedStructure,
  type VerticalTreeNodeShape,
} from "@/lib/vertical-tree";
import {
  canAccessVerticalAdmin,
  loadStateContext,
  stateErrorResponse,
} from "../../../state/_context";

const putSchema = z.object({
  nodes: z
    .array(
      z.object({
        id: z.string().min(1),
        parentId: z.string().min(1).nullable(),
        order: z.number().int().min(0).max(1_000_000),
      }),
    )
    .min(1),
});

export async function PUT(req: NextRequest) {
  try {
    const { stateId, access, snapshot } = await loadStateContext(req);
    if (!canAccessVerticalAdmin(stateId, access, snapshot)) {
      return forbidden();
    }

    const body = putSchema.parse(await req.json());

    const existing = await prisma.verticalNode.findMany({
      where: { stateId },
      select: {
        id: true,
        parentId: true,
        order: true,
        isLobby: true,
        createdAt: true,
      },
    });

    const baseline: VerticalTreeNodeShape[] = existing.map((n) => ({
      id: n.id,
      parentId: n.parentId,
      order: n.order,
      isLobby: n.isLobby,
      createdAt: n.createdAt.toISOString(),
    }));

    const err = validateProposedStructure(baseline, body.nodes);
    if (err) {
      return NextResponse.json(
        { error: messageForValidation(err), code: err.code, detail: err },
        { status: 400 },
      );
    }

    const order = sortForStructuralApply(body.nodes);

    await prisma.$transaction(async (tx) => {
      await tx.verticalNode.updateMany({
        where: { stateId },
        data: { parentId: null },
      });

      for (const id of order) {
        const row = body.nodes.find((n) => n.id === id);
        if (!row) throw new Error("missing row in proposed tree");
        await tx.verticalNode.update({
          where: { id: row.id },
          data: {
            parentId: row.parentId,
            order: row.order,
          },
        });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return stateErrorResponse(err);
  }
}

function messageForValidation(err: {
  code: string;
  nodeId?: string;
  parentId?: string;
}): string {
  switch (err.code) {
    case "cycle":
      return "Структура содержит цикл";
    case "lobby_reparent":
      return "Узел прихожей нельзя переносить";
    case "id_mismatch":
      return "Список узлов не совпадает с состоянием сервера";
    case "unknown_parent":
      return "Недопустимый parentId";
    default:
      return "Некорректная структура дерева";
  }
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
