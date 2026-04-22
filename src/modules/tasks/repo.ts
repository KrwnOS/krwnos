import { PrismaClient } from "@prisma/client";

export class TasksRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ---------------- BOARDS ----------------

  async getBoards(stateId: string) {
    return this.prisma.taskBoard.findMany({
      where: { stateId },
      include: {
        columns: {
          orderBy: { order: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async getBoardById(stateId: string, boardId: string) {
    return this.prisma.taskBoard.findUnique({
      where: { id: boardId, stateId },
      include: {
        columns: {
          orderBy: { order: "asc" },
          include: {
            tasks: {
              orderBy: { order: "asc" },
              include: {
                assignee: {
                  select: { id: true, handle: true, displayName: true, avatarUrl: true },
                },
                createdBy: {
                  select: { id: true, handle: true, displayName: true, avatarUrl: true },
                },
              },
            },
          },
        },
      },
    });
  }

  async createBoard(stateId: string, nodeId: string | null, title: string) {
    return this.prisma.taskBoard.create({
      data: {
        stateId,
        nodeId,
        title,
        columns: {
          create: [
            { title: "To Do", order: 0 },
            { title: "In Progress", order: 1 },
            { title: "Done", order: 2 },
          ],
        },
      },
      include: { columns: true },
    });
  }

  // ---------------- COLUMNS ----------------

  async createColumn(boardId: string, title: string) {
    // Find highest order
    const maxOrderCol = await this.prisma.taskColumn.findFirst({
      where: { boardId },
      orderBy: { order: "desc" },
    });
    const order = maxOrderCol ? maxOrderCol.order + 1 : 0;

    return this.prisma.taskColumn.create({
      data: { boardId, title, order },
    });
  }

  async updateColumnOrder(columnId: string, order: number) {
    return this.prisma.taskColumn.update({
      where: { id: columnId },
      data: { order },
    });
  }

  // ---------------- TASKS ----------------

  async createTask(
    boardId: string,
    columnId: string,
    createdById: string,
    title: string,
    description: string,
    assigneeId: string | null
  ) {
    // Find highest order in the target column
    const maxOrderTask = await this.prisma.task.findFirst({
      where: { columnId },
      orderBy: { order: "desc" },
    });
    const order = maxOrderTask ? maxOrderTask.order + 1 : 0;

    return this.prisma.task.create({
      data: {
        boardId,
        columnId,
        createdById,
        title,
        description,
        assigneeId,
        order,
      },
      include: {
        assignee: {
          select: { id: true, handle: true, displayName: true, avatarUrl: true },
        },
        createdBy: {
          select: { id: true, handle: true, displayName: true, avatarUrl: true },
        },
      },
    });
  }

  async updateTask(
    taskId: string,
    data: {
      title?: string;
      description?: string;
      assigneeId?: string | null;
      columnId?: string;
      order?: number;
    }
  ) {
    return this.prisma.task.update({
      where: { id: taskId },
      data,
      include: {
        assignee: {
          select: { id: true, handle: true, displayName: true, avatarUrl: true },
        },
        createdBy: {
          select: { id: true, handle: true, displayName: true, avatarUrl: true },
        },
      },
    });
  }

  async deleteTask(taskId: string) {
    return this.prisma.task.delete({
      where: { id: taskId },
    });
  }
}
