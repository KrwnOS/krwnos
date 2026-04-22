import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/app/api/chat/_context";
import { TasksService } from "@/modules/tasks/service";
import { TasksRepository } from "@/modules/tasks/repo";
import { permissionsEngine } from "@/core/permissions-engine";
import prisma from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getAuthenticatedContext(req);
    const body = await req.json();
    const service = new TasksService(new TasksRepository(prisma), permissionsEngine);

    if (!body.boardId) {
      return NextResponse.json({ error: "boardId is required" }, { status: 400 });
    }

    const task = await service.updateTask(ctx, params.id, body.boardId, {
      title: body.title,
      description: body.description,
      assigneeId: body.assigneeId,
      columnId: body.columnId,
      order: body.order,
    });

    return NextResponse.json({ task });
  } catch (err: any) {
    if (err.code === "UNAUTHORIZED" || err.code === "FORBIDDEN") {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHORIZED" ? 401 : 403 });
    }
    if (err.code === "NOT_FOUND") {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
