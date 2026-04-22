import { KrwnError, type ModuleContext, type PermissionKey } from "@krwnos/sdk";
import { PermissionsEngine } from "@/core/permissions-engine";
import type { VerticalSnapshot } from "@/types/kernel";
import { TasksRepository } from "./repo";
import { TASK_PERMISSIONS } from "./permissions";

/**
 * Access context a `TasksService` method needs on top of `ModuleContext`
 * in order to drive the `PermissionsEngine`. Mirrors the `ChatAccessContext`
 * pattern used by other first-party modules — S1.2 will extract a shared
 * helper, at which point this should be retired in favour of whatever
 * the SDK grows to expose on `ctx`.
 */
export interface TasksAccessContext {
  isOwner: boolean;
  snapshot: VerticalSnapshot;
}

export class TasksService {
  constructor(
    private readonly repo: TasksRepository,
    private readonly permissions: PermissionsEngine,
  ) {}

  private canGlobal(
    ctx: ModuleContext,
    access: TasksAccessContext,
    userId: string,
    key: PermissionKey,
  ): boolean {
    return this.permissions.can(
      {
        stateId: ctx.stateId,
        userId,
        isOwner: access.isOwner,
        snapshot: access.snapshot,
      },
      key,
    );
  }

  private canOnNode(
    ctx: ModuleContext,
    access: TasksAccessContext,
    userId: string,
    key: PermissionKey,
    nodeId: string,
  ): boolean {
    if (access.isOwner) return true;
    if (!this.canGlobal(ctx, access, userId, key)) return false;
    return this.permissions.isMemberOfNodeOrAncestor(
      { userId, isOwner: false, snapshot: access.snapshot },
      nodeId,
    ).granted;
  }

  /**
   * Retrieves all boards the current user has access to.
   */
  async getAccessibleBoards(ctx: ModuleContext, access: TasksAccessContext) {
    if (!ctx.auth) throw new KrwnError("Unauthorized", "UNAUTHORIZED");

    const userId = ctx.auth.userId;

    // Must have read permission globally (or at a node, checked per-board below).
    const readKey = TASK_PERMISSIONS.read as PermissionKey;
    const hasGlobalRead = this.canGlobal(ctx, access, userId, readKey);

    const allBoards = await this.repo.getBoards(ctx.stateId);

    const accessibleBoards = [];
    for (const board of allBoards) {
      if (!board.nodeId) {
        if (hasGlobalRead) accessibleBoards.push(board);
      } else if (this.canOnNode(ctx, access, userId, readKey, board.nodeId)) {
        accessibleBoards.push(board);
      }
    }

    if (!hasGlobalRead && accessibleBoards.length === 0) {
      throw new KrwnError("Missing tasks.read permission", "FORBIDDEN");
    }

    return accessibleBoards;
  }

  async getBoardById(
    ctx: ModuleContext,
    access: TasksAccessContext,
    boardId: string,
  ) {
    if (!ctx.auth) throw new KrwnError("Unauthorized", "UNAUTHORIZED");

    const userId = ctx.auth.userId;
    const readKey = TASK_PERMISSIONS.read as PermissionKey;

    const board = await this.repo.getBoardById(ctx.stateId, boardId);
    if (!board) throw new KrwnError("Board not found", "NOT_FOUND");

    if (board.nodeId) {
      if (!this.canOnNode(ctx, access, userId, readKey, board.nodeId)) {
        throw new KrwnError(
          "Missing tasks.read permission for this node",
          "FORBIDDEN",
        );
      }
    } else {
      if (!this.canGlobal(ctx, access, userId, readKey)) {
        throw new KrwnError("Missing tasks.read permission", "FORBIDDEN");
      }
    }

    return board;
  }

  async createBoard(
    ctx: ModuleContext,
    access: TasksAccessContext,
    title: string,
    nodeId: string | null = null,
  ) {
    if (!ctx.auth) throw new KrwnError("Unauthorized", "UNAUTHORIZED");

    const userId = ctx.auth.userId;
    const adminKey = TASK_PERMISSIONS.admin as PermissionKey;

    const canAdmin = nodeId
      ? this.canOnNode(ctx, access, userId, adminKey, nodeId)
      : this.canGlobal(ctx, access, userId, adminKey);

    if (!canAdmin) {
      throw new KrwnError("Missing tasks.admin permission", "FORBIDDEN");
    }

    const board = await this.repo.createBoard(ctx.stateId, nodeId, title);

    await ctx.bus.emit("core.tasks.board.created", {
      boardId: board.id,
      title,
      nodeId,
    });

    return board;
  }

  async createTask(
    ctx: ModuleContext,
    access: TasksAccessContext,
    boardId: string,
    columnId: string,
    title: string,
    description: string,
    assigneeId: string | null = null,
  ) {
    if (!ctx.auth) throw new KrwnError("Unauthorized", "UNAUTHORIZED");

    const userId = ctx.auth.userId;
    const writeKey = TASK_PERMISSIONS.write as PermissionKey;

    const board = await this.repo.getBoardById(ctx.stateId, boardId);
    if (!board) throw new KrwnError("Board not found", "NOT_FOUND");

    const canWrite = board.nodeId
      ? this.canOnNode(ctx, access, userId, writeKey, board.nodeId)
      : this.canGlobal(ctx, access, userId, writeKey);

    if (!canWrite) {
      throw new KrwnError("Missing tasks.write permission", "FORBIDDEN");
    }

    const task = await this.repo.createTask(
      boardId,
      columnId,
      userId,
      title,
      description,
      assigneeId,
    );

    await ctx.bus.emit("core.tasks.task.created", {
      taskId: task.id,
      boardId,
      title,
    });

    return task;
  }

  async updateTask(
    ctx: ModuleContext,
    access: TasksAccessContext,
    taskId: string,
    boardId: string,
    data: {
      title?: string;
      description?: string;
      assigneeId?: string | null;
      columnId?: string;
      order?: number;
    },
  ) {
    if (!ctx.auth) throw new KrwnError("Unauthorized", "UNAUTHORIZED");

    const userId = ctx.auth.userId;
    const writeKey = TASK_PERMISSIONS.write as PermissionKey;

    const board = await this.repo.getBoardById(ctx.stateId, boardId);
    if (!board) throw new KrwnError("Board not found", "NOT_FOUND");

    const canWrite = board.nodeId
      ? this.canOnNode(ctx, access, userId, writeKey, board.nodeId)
      : this.canGlobal(ctx, access, userId, writeKey);

    if (!canWrite) {
      throw new KrwnError("Missing tasks.write permission", "FORBIDDEN");
    }

    const task = await this.repo.updateTask(taskId, data);

    await ctx.bus.emit("core.tasks.task.updated", {
      taskId,
      updates: Object.keys(data),
    });

    return task;
  }
}
