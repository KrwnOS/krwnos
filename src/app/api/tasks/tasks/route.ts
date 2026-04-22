import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/app/api/chat/_context";
import { TasksService } from "@/modules/tasks/service";
import { TasksRepository } from "@/modules/tasks/repo";
import { permissionsEngine } from "@/core/permissions-engine";
import prisma from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthenticatedContext(req);
    const body = await req.json();
    const service = new TasksService(new TasksRepository(prisma), permissionsEngine);

    if (!body.boardId || !body.columnId || !body.title) {
      return NextResponse.json({ error: "boardId, columnId, and title are required" }, { status: 400 });
    }

    const task = await service.createTask(
      ctx,
      body.boardId,
      body.columnId,
      body.title,
      body.description || "",
      body.assigneeId || null
    );

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
