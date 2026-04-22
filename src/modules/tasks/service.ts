import { KrwnError, ModuleContext } from "@krwnos/sdk";
import { PermissionsEngine } from "@/core/permissions-engine";
import { TasksRepository } from "./repo";
import { TASK_PERMISSIONS } from "./permissions";

export class TasksService {
  constructor(
    private readonly repo: TasksRepository,
    private readonly permissions: PermissionsEngine
  ) {}

  /**
   * Retrieves all boards the current user has access to.
   */
  async getAccessibleBoards(ctx: ModuleContext) {
    if (!ctx.auth) throw new KrwnError("Unauthorized", "UNAUTHORIZED");

    // Must have read permission
    if (!this.permissions.can(ctx.stateId, ctx.auth.userId, TASK_PERMISSIONS.read)) {
      throw new KrwnError("Missing tasks.read permission", "FORBIDDEN");
    }

    const allBoards = await this.repo.getBoards(ctx.stateId);

    // Filter by node access: a user can see a board if it has no node bound,
    // or if they are a member of that node (or its ancestor).
    // The PermissionsEngine provides `isMemberOfNodeOrAncestor` if we load memberships,
    // but a quicker check is if they hold `tasks.read` AT that node.
    
    // For simplicity, if they have global `tasks.read` they see all open boards.
    // To truly check per-node, we use the permissions engine.
    const accessibleBoards = [];
    for (const board of allBoards) {
      if (!board.nodeId) {
        accessibleBoards.push(board);
      } else {
        const canReadNode = this.permissions.can(ctx.stateId, ctx.auth.userId, TASK_PERMISSIONS.read, board.nodeId);
        if (canReadNode) {
          accessibleBoards.push(board);
        }
      }
    }

    return accessibleBoards;
  }

  async getBoardById(ctx: ModuleContext, boardId: string) {
    if (!ctx.auth) throw new KrwnError("Unauthorized", "UNAUTHORIZED");

    const board = await this.repo.getBoardById(ctx.stateId, boardId);
    if (!board) throw new KrwnError("Board not found", "NOT_FOUND");

    if (board.nodeId) {
      const canReadNode = this.permissions.can(ctx.stateId, ctx.auth.userId, TASK_PERMISSIONS.read, board.nodeId);
      if (!canReadNode) {
        throw new KrwnError("Missing tasks.read permission for this node", "FORBIDDEN");
      }
    } else {
      if (!this.permissions.can(ctx.stateId, ctx.auth.userId, TASK_PERMISSIONS.read)) {
        throw new KrwnError("Missing tasks.read permission", "FORBIDDEN");
      }
    }

    return board;
  }

  async createBoard(ctx: ModuleContext, title: string, nodeId: string | null = null) {
    if (!ctx.auth) throw new KrwnError("Unauthorized", "UNAUTHORIZED");

    const canAdmin = nodeId 
      ? this.permissions.can(ctx.stateId, ctx.auth.userId, TASK_PERMISSIONS.admin, nodeId)
      : this.permissions.can(ctx.stateId, ctx.auth.userId, TASK_PERMISSIONS.admin);

    if (!canAdmin) {
      throw new KrwnError("Missing tasks.admin permission", "FORBIDDEN");
    }

    const board = await this.repo.createBoard(ctx.stateId, nodeId, title);
    
    // Emit event
    await ctx.events.emit("core.tasks.board.created", { boardId: board.id, title, nodeId });

    return board;
  }

  async createTask(
    ctx: ModuleContext,
    boardId: string,
    columnId: string,
    title: string,
    description: string,
    assigneeId: string | null = null
  ) {
    if (!ctx.auth) throw new KrwnError("Unauthorized", "UNAUTHORIZED");

    const board = await this.repo.getBoardById(ctx.stateId, boardId);
    if (!board) throw new KrwnError("Board not found", "NOT_FOUND");

    const canWrite = board.nodeId
      ? this.permissions.can(ctx.stateId, ctx.auth.userId, TASK_PERMISSIONS.write, board.nodeId)
      : this.permissions.can(ctx.stateId, ctx.auth.userId, TASK_PERMISSIONS.write);

    if (!canWrite) {
      throw new KrwnError("Missing tasks.write permission", "FORBIDDEN");
    }

    const task = await this.repo.createTask(boardId, columnId, ctx.auth.userId, title, description, assigneeId);

    // Emit event
    await ctx.events.emit("core.tasks.task.created", { taskId: task.id, boardId, title });

    return task;
  }

  async updateTask(
    ctx: ModuleContext,
    taskId: string,
    boardId: string,
    data: {
      title?: string;
      description?: string;
      assigneeId?: string | null;
      columnId?: string;
      order?: number;
    }
  ) {
    if (!ctx.auth) throw new KrwnError("Unauthorized", "UNAUTHORIZED");

    const board = await this.repo.getBoardById(ctx.stateId, boardId);
    if (!board) throw new KrwnError("Board not found", "NOT_FOUND");

    const canWrite = board.nodeId
      ? this.permissions.can(ctx.stateId, ctx.auth.userId, TASK_PERMISSIONS.write, board.nodeId)
      : this.permissions.can(ctx.stateId, ctx.auth.userId, TASK_PERMISSIONS.write);

    if (!canWrite) {
      throw new KrwnError("Missing tasks.write permission", "FORBIDDEN");
    }

    const task = await this.repo.updateTask(taskId, data);

    // Emit event
    await ctx.events.emit("core.tasks.task.updated", { taskId, updates: Object.keys(data) });

    return task;
  }
}
