import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/app/api/chat/_context";
import { TasksService } from "@/modules/tasks/service";
import { TasksRepository } from "@/modules/tasks/repo";
import { permissionsEngine } from "@/core/permissions-engine";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const { ctx, access } = await getAuthenticatedContext(req);
    const service = new TasksService(new TasksRepository(prisma), permissionsEngine);
    const boards = await service.getAccessibleBoards(ctx, access);
    return NextResponse.json({ boards });
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === "UNAUTHORIZED" || e.code === "FORBIDDEN") {
      return NextResponse.json({ error: e.message }, { status: e.code === "UNAUTHORIZED" ? 401 : 403 });
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { ctx, access } = await getAuthenticatedContext(req);
    const body = await req.json();
    const service = new TasksService(new TasksRepository(prisma), permissionsEngine);

    if (!body.title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const board = await service.createBoard(ctx, access, body.title, body.nodeId || null);
    return NextResponse.json({ board });
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === "UNAUTHORIZED" || e.code === "FORBIDDEN") {
      return NextResponse.json({ error: e.message }, { status: e.code === "UNAUTHORIZED" ? 401 : 403 });
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
