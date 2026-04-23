/**
 * Unit tests for `TasksService` against a mocked `TasksRepository` and a
 * real `PermissionsEngine`.
 *
 * Covers the canonical invariants of `core.tasks`:
 *
 *   * `ctx.auth` is required for every public method — `null` throws
 *     `UNAUTHORIZED` rather than silently falling through.
 *   * Board reads require `core.tasks.read`, per-node boards require
 *     read on that node's branch (direct or inherited).
 *   * Board writes require `core.tasks.admin` for creation; task
 *     creation/updates require `core.tasks.write`, scoped to the
 *     board's `nodeId` when set.
 *   * The Sovereign (`isOwner`) bypasses every check.
 *   * `getAccessibleBoards` filters out node-scoped boards whose node
 *     the caller cannot reach via the permissions engine, and throws
 *     `FORBIDDEN` only when no board is reachable AND the caller has
 *     no global read either.
 *   * Happy paths emit the documented event-bus topics.
 *
 * The repo is a plain object typed as `TasksRepository` — no Prisma,
 * no DB. The permissions engine is the real singleton constructed in
 * each test so there's no mutable global state between cases.
 */

import { describe, expect, it, vi } from "vitest";
import { KrwnError } from "@krwnos/sdk";
import type { ModuleContext, ModuleEventBus, PermissionKey } from "@krwnos/sdk";
import { PermissionsEngine } from "@/core/permissions-engine";
import type { VerticalNode, VerticalSnapshot } from "@/types/kernel";
import { TasksService, type TasksAccessContext } from "../service";
import { TasksRepository } from "../repo";
import { TASK_PERMISSIONS } from "../permissions";

// ------------------------------------------------------------
// Fixtures: a tiny Vertical
//
//   root                  (no perms, no members)
//   └── readers           (tasks.read)            ← READER_ID
//   └── writers           (tasks.read, tasks.write, tasks.admin) ← WRITER_ID
//
// Sovereign owns State `s1`. OUTSIDER has no membership.
// ------------------------------------------------------------

const STATE_ID = "s1";
const OWNER_ID = "u-sovereign";
const READER_ID = "u-reader";
const WRITER_ID = "u-writer";
const OUTSIDER_ID = "u-outsider";

const ROOT_NODE_ID = "n-root";
const READERS_NODE_ID = "n-readers";
const WRITERS_NODE_ID = "n-writers";

function buildSnapshot(): VerticalSnapshot {
  const now = new Date("2026-01-01T00:00:00Z");
  const root: VerticalNode = {
    id: ROOT_NODE_ID,
    stateId: STATE_ID,
    parentId: null,
    title: "Государство",
    type: "department",
    permissions: [],
    order: 0,
    createdAt: now,
    updatedAt: now,
  };
  const readers: VerticalNode = {
    ...root,
    id: READERS_NODE_ID,
    parentId: ROOT_NODE_ID,
    title: "Читатели",
    type: "position",
    permissions: [TASK_PERMISSIONS.read as PermissionKey],
  };
  const writers: VerticalNode = {
    ...root,
    id: WRITERS_NODE_ID,
    parentId: ROOT_NODE_ID,
    title: "Писатели",
    type: "position",
    permissions: [
      TASK_PERMISSIONS.read as PermissionKey,
      TASK_PERMISSIONS.write as PermissionKey,
      TASK_PERMISSIONS.admin as PermissionKey,
    ],
  };

  const nodes = new Map<string, VerticalNode>();
  nodes.set(root.id, root);
  nodes.set(readers.id, readers);
  nodes.set(writers.id, writers);

  const membershipsByUser = new Map<string, Set<string>>();
  membershipsByUser.set(READER_ID, new Set([READERS_NODE_ID]));
  membershipsByUser.set(WRITER_ID, new Set([WRITERS_NODE_ID]));

  return { stateId: STATE_ID, nodes, membershipsByUser };
}

function buildAccess(opts: { isOwner?: boolean } = {}): TasksAccessContext {
  return {
    isOwner: opts.isOwner ?? false,
    snapshot: buildSnapshot(),
  };
}

// ------------------------------------------------------------
// Recording event bus + test ModuleContext.
// ------------------------------------------------------------

interface RecordedEvent {
  event: string;
  payload: unknown;
}

function createBus(): { bus: ModuleEventBus; events: RecordedEvent[] } {
  const events: RecordedEvent[] = [];
  const bus: ModuleEventBus = {
    async emit(event, payload) {
      events.push({ event, payload });
    },
    on() {
      return () => undefined;
    },
  };
  return { bus, events };
}

function buildCtx(
  userId: string | null,
  bus: ModuleEventBus,
): ModuleContext {
  return {
    stateId: STATE_ID,
    userId,
    auth: userId ? { userId } : null,
    permissions: new Set<PermissionKey>(),
    bus,
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    secrets: { async get() { return null; } },
    db: {
      async transaction(fn) {
        return fn({
          async queryRaw() { return []; },
          async executeRaw() { return 0; },
        });
      },
    },
  };
}

// ------------------------------------------------------------
// In-memory TasksRepository. Stays intentionally tiny — we only
// stub the methods `TasksService` calls.
// ------------------------------------------------------------

type BoardRow = {
  id: string;
  stateId: string;
  nodeId: string | null;
  title: string;
  createdAt: Date;
  updatedAt: Date;
};

type TaskRow = {
  id: string;
  boardId: string;
  columnId: string;
  createdById: string;
  title: string;
  description: string;
  assigneeId: string | null;
  order: number;
};

interface RepoSeed {
  boards?: BoardRow[];
}

function createRepo(seed: RepoSeed = {}): {
  repo: TasksRepository;
  boards: Map<string, BoardRow>;
  tasks: Map<string, TaskRow>;
} {
  const boards = new Map<string, BoardRow>();
  for (const b of seed.boards ?? []) boards.set(b.id, { ...b });
  const tasks = new Map<string, TaskRow>();

  let boardCounter = boards.size + 1;
  let taskCounter = 1;

  const repo = {
    async getBoards(stateId: string) {
      return [...boards.values()]
        .filter((b) => b.stateId === stateId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((b) => ({ ...b, columns: [] }));
    },
    async getBoardById(stateId: string, boardId: string) {
      const row = boards.get(boardId);
      if (!row || row.stateId !== stateId) return null;
      return { ...row, columns: [] };
    },
    async createBoard(stateId: string, nodeId: string | null, title: string) {
      const id = `b-${boardCounter++}`;
      const now = new Date();
      const board: BoardRow = {
        id,
        stateId,
        nodeId,
        title,
        createdAt: now,
        updatedAt: now,
      };
      boards.set(id, board);
      return { ...board, columns: [] };
    },
    async createTask(
      boardId: string,
      columnId: string,
      createdById: string,
      title: string,
      description: string,
      assigneeId: string | null,
    ) {
      const id = `t-${taskCounter++}`;
      const row: TaskRow = {
        id,
        boardId,
        columnId,
        createdById,
        title,
        description,
        assigneeId,
        order: tasks.size,
      };
      tasks.set(id, row);
      return { ...row };
    },
    async updateTask(
      taskId: string,
      data: {
        title?: string;
        description?: string;
        assigneeId?: string | null;
        columnId?: string;
        order?: number;
      },
    ) {
      const existing = tasks.get(taskId);
      if (!existing) {
        throw new Error(`task ${taskId} not found`);
      }
      const next: TaskRow = { ...existing };
      if (data.title !== undefined) next.title = data.title;
      if (data.description !== undefined) next.description = data.description;
      if (data.assigneeId !== undefined) next.assigneeId = data.assigneeId;
      if (data.columnId !== undefined) next.columnId = data.columnId;
      if (data.order !== undefined) next.order = data.order;
      tasks.set(taskId, next);
      return { ...next };
    },
  } as unknown as TasksRepository;

  return { repo, boards, tasks };
}

function build(seed: RepoSeed = {}) {
  const { repo, boards, tasks } = createRepo(seed);
  const engine = new PermissionsEngine();
  const service = new TasksService(repo, engine);
  const { bus, events } = createBus();
  return { service, repo, boards, tasks, engine, bus, events };
}

// ------------------------------------------------------------
// getAccessibleBoards
// ------------------------------------------------------------

describe("TasksService.getAccessibleBoards", () => {
  it("throws UNAUTHORIZED when ctx.auth is null", async () => {
    const env = build();
    await expect(
      env.service.getAccessibleBoards(buildCtx(null, env.bus), buildAccess()),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("throws FORBIDDEN when caller has no tasks.read and no reachable boards", async () => {
    const env = build({
      boards: [
        {
          id: "b-global",
          stateId: STATE_ID,
          nodeId: null,
          title: "Global",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    });
    await expect(
      env.service.getAccessibleBoards(
        buildCtx(OUTSIDER_ID, env.bus),
        buildAccess(),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns all global boards when caller has global tasks.read (via node membership)", async () => {
    const env = build({
      boards: [
        {
          id: "b-global",
          stateId: STATE_ID,
          nodeId: null,
          title: "Global",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    });
    const boards = await env.service.getAccessibleBoards(
      buildCtx(READER_ID, env.bus),
      buildAccess(),
    );
    expect(boards).toHaveLength(1);
    expect(boards[0]?.id).toBe("b-global");
  });

  it("the Sovereign sees every board regardless of nodeId", async () => {
    const env = build({
      boards: [
        {
          id: "b-global",
          stateId: STATE_ID,
          nodeId: null,
          title: "Global",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-01-01T00:00:00Z"),
        },
        {
          id: "b-writers",
          stateId: STATE_ID,
          nodeId: WRITERS_NODE_ID,
          title: "Writers-only",
          createdAt: new Date("2026-01-02T00:00:00Z"),
          updatedAt: new Date("2026-01-02T00:00:00Z"),
        },
      ],
    });
    const boards = await env.service.getAccessibleBoards(
      buildCtx(OWNER_ID, env.bus),
      buildAccess({ isOwner: true }),
    );
    expect(boards.map((b) => b.id).sort()).toEqual(["b-global", "b-writers"]);
  });

  it("filters out node-scoped boards whose node the caller cannot reach", async () => {
    // READER_ID belongs to the 'readers' node, which only grants
    // tasks.read. A board bound to the 'writers' node is invisible
    // to them because they have no membership on that branch.
    const env = build({
      boards: [
        {
          id: "b-global",
          stateId: STATE_ID,
          nodeId: null,
          title: "Global",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-01-01T00:00:00Z"),
        },
        {
          id: "b-writers",
          stateId: STATE_ID,
          nodeId: WRITERS_NODE_ID,
          title: "Writers-only",
          createdAt: new Date("2026-01-02T00:00:00Z"),
          updatedAt: new Date("2026-01-02T00:00:00Z"),
        },
      ],
    });
    const boards = await env.service.getAccessibleBoards(
      buildCtx(READER_ID, env.bus),
      buildAccess(),
    );
    expect(boards.map((b) => b.id)).toEqual(["b-global"]);
  });

  it("returns a node-scoped board when the engine says yes on its nodeId", async () => {
    // WRITER_ID belongs to the 'writers' node which grants read+write+admin.
    const env = build({
      boards: [
        {
          id: "b-writers",
          stateId: STATE_ID,
          nodeId: WRITERS_NODE_ID,
          title: "Writers-only",
          createdAt: new Date("2026-01-02T00:00:00Z"),
          updatedAt: new Date("2026-01-02T00:00:00Z"),
        },
      ],
    });
    const boards = await env.service.getAccessibleBoards(
      buildCtx(WRITER_ID, env.bus),
      buildAccess(),
    );
    expect(boards).toHaveLength(1);
    expect(boards[0]?.id).toBe("b-writers");
  });

  it("returns an empty list (not FORBIDDEN) when caller has global read but no boards exist", async () => {
    const env = build({ boards: [] });
    const boards = await env.service.getAccessibleBoards(
      buildCtx(READER_ID, env.bus),
      buildAccess(),
    );
    expect(boards).toEqual([]);
  });
});

// ------------------------------------------------------------
// getBoardById
// ------------------------------------------------------------

describe("TasksService.getBoardById", () => {
  it("throws UNAUTHORIZED without ctx.auth", async () => {
    const env = build();
    await expect(
      env.service.getBoardById(buildCtx(null, env.bus), buildAccess(), "b-1"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("throws NOT_FOUND for a board that doesn't exist in this state", async () => {
    const env = build();
    await expect(
      env.service.getBoardById(
        buildCtx(OWNER_ID, env.bus),
        buildAccess({ isOwner: true }),
        "missing",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws FORBIDDEN on a global board when caller lacks tasks.read", async () => {
    const env = build({
      boards: [
        {
          id: "b-global",
          stateId: STATE_ID,
          nodeId: null,
          title: "Global",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    });
    await expect(
      env.service.getBoardById(
        buildCtx(OUTSIDER_ID, env.bus),
        buildAccess(),
        "b-global",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws FORBIDDEN on a node-scoped board when the caller cannot reach that node", async () => {
    const env = build({
      boards: [
        {
          id: "b-writers",
          stateId: STATE_ID,
          nodeId: WRITERS_NODE_ID,
          title: "Writers-only",
          createdAt: new Date("2026-01-02T00:00:00Z"),
          updatedAt: new Date("2026-01-02T00:00:00Z"),
        },
      ],
    });
    await expect(
      env.service.getBoardById(
        buildCtx(READER_ID, env.bus),
        buildAccess(),
        "b-writers",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns the board when caller has the right permission scope", async () => {
    const env = build({
      boards: [
        {
          id: "b-global",
          stateId: STATE_ID,
          nodeId: null,
          title: "Global",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    });
    const board = await env.service.getBoardById(
      buildCtx(READER_ID, env.bus),
      buildAccess(),
      "b-global",
    );
    expect(board.id).toBe("b-global");
  });
});

// ------------------------------------------------------------
// createBoard
// ------------------------------------------------------------

describe("TasksService.createBoard", () => {
  it("throws UNAUTHORIZED without ctx.auth", async () => {
    const env = build();
    await expect(
      env.service.createBoard(
        buildCtx(null, env.bus),
        buildAccess(),
        "New",
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("throws FORBIDDEN for a global board when caller lacks tasks.admin", async () => {
    const env = build();
    await expect(
      env.service.createBoard(
        buildCtx(READER_ID, env.bus),
        buildAccess(),
        "New",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("creates a global board when caller is Sovereign and emits board.created", async () => {
    const env = build();
    const board = await env.service.createBoard(
      buildCtx(OWNER_ID, env.bus),
      buildAccess({ isOwner: true }),
      "New",
    );
    expect(board.title).toBe("New");
    expect(board.nodeId).toBeNull();
    expect(env.events).toEqual([
      {
        event: "core.tasks.board.created",
        payload: expect.objectContaining({
          boardId: board.id,
          title: "New",
          nodeId: null,
        }),
      },
    ]);
  });

  it("creates a node-scoped board when caller has tasks.admin at that node", async () => {
    const env = build();
    const board = await env.service.createBoard(
      buildCtx(WRITER_ID, env.bus),
      buildAccess(),
      "Team board",
      WRITERS_NODE_ID,
    );
    expect(board.nodeId).toBe(WRITERS_NODE_ID);
  });

  it("throws FORBIDDEN on a node-scoped board when caller lacks admin on that node", async () => {
    const env = build();
    // READER_ID has tasks.read, NOT tasks.admin — must be blocked.
    await expect(
      env.service.createBoard(
        buildCtx(READER_ID, env.bus),
        buildAccess(),
        "Team board",
        READERS_NODE_ID,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ------------------------------------------------------------
// createTask
// ------------------------------------------------------------

describe("TasksService.createTask", () => {
  it("throws UNAUTHORIZED without ctx.auth", async () => {
    const env = build();
    await expect(
      env.service.createTask(
        buildCtx(null, env.bus),
        buildAccess(),
        "b-1",
        "c-1",
        "T",
        "Desc",
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("throws NOT_FOUND when the board doesn't exist", async () => {
    const env = build();
    await expect(
      env.service.createTask(
        buildCtx(WRITER_ID, env.bus),
        buildAccess(),
        "missing",
        "c-1",
        "T",
        "Desc",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws FORBIDDEN when caller lacks tasks.write on a global board", async () => {
    const env = build({
      boards: [
        {
          id: "b-global",
          stateId: STATE_ID,
          nodeId: null,
          title: "Global",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    });
    await expect(
      env.service.createTask(
        buildCtx(READER_ID, env.bus),
        buildAccess(),
        "b-global",
        "c-1",
        "T",
        "Desc",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws FORBIDDEN when caller lacks write on the board's node", async () => {
    const env = build({
      boards: [
        {
          id: "b-writers",
          stateId: STATE_ID,
          nodeId: WRITERS_NODE_ID,
          title: "Writers-only",
          createdAt: new Date("2026-01-02T00:00:00Z"),
          updatedAt: new Date("2026-01-02T00:00:00Z"),
        },
      ],
    });
    await expect(
      env.service.createTask(
        buildCtx(READER_ID, env.bus),
        buildAccess(),
        "b-writers",
        "c-1",
        "T",
        "Desc",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("creates the task and emits task.created on the happy path", async () => {
    const env = build({
      boards: [
        {
          id: "b-writers",
          stateId: STATE_ID,
          nodeId: WRITERS_NODE_ID,
          title: "Writers-only",
          createdAt: new Date("2026-01-02T00:00:00Z"),
          updatedAt: new Date("2026-01-02T00:00:00Z"),
        },
      ],
    });
    const task = await env.service.createTask(
      buildCtx(WRITER_ID, env.bus),
      buildAccess(),
      "b-writers",
      "c-1",
      "T",
      "Desc",
      null,
    );
    expect(task.title).toBe("T");
    expect(task.createdById).toBe(WRITER_ID);
    expect(env.events.map((e) => e.event)).toEqual([
      "core.tasks.task.created",
    ]);
  });
});

// ------------------------------------------------------------
// updateTask
// ------------------------------------------------------------

describe("TasksService.updateTask", () => {
  it("throws UNAUTHORIZED without ctx.auth", async () => {
    const env = build();
    await expect(
      env.service.updateTask(
        buildCtx(null, env.bus),
        buildAccess(),
        "t-1",
        "b-1",
        { title: "x" },
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("throws NOT_FOUND when the board doesn't exist", async () => {
    const env = build();
    await expect(
      env.service.updateTask(
        buildCtx(WRITER_ID, env.bus),
        buildAccess(),
        "t-1",
        "missing",
        { title: "x" },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws FORBIDDEN when caller lacks tasks.write on the board's node", async () => {
    const env = build({
      boards: [
        {
          id: "b-writers",
          stateId: STATE_ID,
          nodeId: WRITERS_NODE_ID,
          title: "Writers-only",
          createdAt: new Date("2026-01-02T00:00:00Z"),
          updatedAt: new Date("2026-01-02T00:00:00Z"),
        },
      ],
    });
    await expect(
      env.service.updateTask(
        buildCtx(READER_ID, env.bus),
        buildAccess(),
        "t-1",
        "b-writers",
        { columnId: "c-2" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("updates the task and emits task.updated with the keys that changed", async () => {
    const env = build({
      boards: [
        {
          id: "b-writers",
          stateId: STATE_ID,
          nodeId: WRITERS_NODE_ID,
          title: "Writers-only",
          createdAt: new Date("2026-01-02T00:00:00Z"),
          updatedAt: new Date("2026-01-02T00:00:00Z"),
        },
      ],
    });
    // Seed a task in the mock.
    const seeded = await env.service.createTask(
      buildCtx(WRITER_ID, env.bus),
      buildAccess(),
      "b-writers",
      "c-1",
      "Original",
      "Orig",
    );
    env.events.length = 0;

    const updated = await env.service.updateTask(
      buildCtx(WRITER_ID, env.bus),
      buildAccess(),
      seeded.id,
      "b-writers",
      { title: "Renamed", columnId: "c-2" },
    );
    expect(updated.title).toBe("Renamed");
    expect(updated.columnId).toBe("c-2");
    expect(env.events).toEqual([
      {
        event: "core.tasks.task.updated",
        payload: {
          taskId: seeded.id,
          updates: ["title", "columnId"],
        },
      },
    ]);
  });

  it("global-board updates still require global tasks.write", async () => {
    const env = build({
      boards: [
        {
          id: "b-global",
          stateId: STATE_ID,
          nodeId: null,
          title: "Global",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    });
    await expect(
      env.service.updateTask(
        buildCtx(READER_ID, env.bus),
        buildAccess(),
        "t-missing",
        "b-global",
        { title: "x" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ------------------------------------------------------------
// KrwnError shape — spot-check that the errors the service raises
// really are `KrwnError` instances (not plain Error), since
// downstream route handlers branch on `instanceof KrwnError`.
// ------------------------------------------------------------

describe("TasksService error shape", () => {
  it("UNAUTHORIZED is a KrwnError", async () => {
    const env = build();
    const err = await env.service
      .getAccessibleBoards(buildCtx(null, env.bus), buildAccess())
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KrwnError);
    expect((err as KrwnError).code).toBe("UNAUTHORIZED");
  });

  it("FORBIDDEN is a KrwnError", async () => {
    const env = build();
    const err = await env.service
      .createBoard(buildCtx(READER_ID, env.bus), buildAccess(), "x")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KrwnError);
    expect((err as KrwnError).code).toBe("FORBIDDEN");
  });
});

// ------------------------------------------------------------
// Module manifest smoke — exercises `src/modules/tasks/index.ts`
// so its exported lifecycle functions are counted by coverage.
// ------------------------------------------------------------

describe("coreTasksModule manifest", () => {
  it("init() returns the task permission descriptors", async () => {
    const { coreTasksModule } = await import("../index");
    const init = await coreTasksModule.init();
    expect(init.permissions.map((p) => p.key)).toEqual(
      expect.arrayContaining([
        "core.tasks.read",
        "core.tasks.write",
        "core.tasks.admin",
      ]),
    );
  });

  it("getWidget returns the Kanban widget descriptor guarded by tasks.read", async () => {
    const { coreTasksModule } = await import("../index");
    const { bus } = createBus();
    const widget = coreTasksModule.getWidget(buildCtx(OWNER_ID, bus));
    // The contract allows null / single / array; core.tasks returns a
    // single descriptor, so narrow to that.
    expect(widget && !Array.isArray(widget)).toBe(true);
    if (widget && !Array.isArray(widget)) {
      expect(widget.requiredPermission).toBe("core.tasks.read");
      expect(widget.component).toBe("KanbanWidget");
    }
  });

  it("getSettings returns null — core.tasks has no settings panel yet", async () => {
    const { coreTasksModule } = await import("../index");
    const { bus } = createBus();
    expect(coreTasksModule.getSettings(buildCtx(OWNER_ID, bus))).toBeNull();
  });
});

// Keep vi in scope without a standalone test so unused-import lint
// passes even when we add/remove mocks in the future.
void vi;
