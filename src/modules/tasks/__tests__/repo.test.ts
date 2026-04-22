/**
 * Unit tests for `TasksRepository`.
 *
 * The repo is a thin wrapper over Prisma today — no domain-level
 * validation, no error translation. These tests:
 *
 *   1. Pin the exact Prisma arguments the repo emits, so the next
 *      person who touches the model/columns layout sees the ripple
 *      in a single-line diff.
 *   2. Cover ordering logic for columns and tasks (the repo computes
 *      `order = max(existing.order) + 1`).
 *   3. Confirm that errors from Prisma bubble up unchanged — the repo
 *      does NOT try to reinterpret `P2002`/`P2025` as domain errors.
 *      S1.2/S1.3 should formalize a translation layer; see the PR
 *      description for the follow-up note.
 *
 * The Prisma client is a hand-rolled mock. `as unknown as PrismaClient`
 * is the smallest contact surface that still lets TypeScript verify
 * the repo's signatures.
 */

import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { TasksRepository } from "../repo";

const STATE_ID = "s1";

// ------------------------------------------------------------
// Mock factory — one per test so vi.fn() call counts are fresh.
// Each delegate method is a `vi.fn()` the test can stub / assert.
// ------------------------------------------------------------

function createMockPrisma() {
  const taskBoard = {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
  };
  const taskColumn = {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const task = {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  const prisma = { taskBoard, taskColumn, task } as unknown as PrismaClient;
  return { prisma, taskBoard, taskColumn, task };
}

// ------------------------------------------------------------
// Boards
// ------------------------------------------------------------

describe("TasksRepository — boards", () => {
  it("getBoards scopes by stateId, includes columns (asc), orders by createdAt", async () => {
    const { prisma, taskBoard } = createMockPrisma();
    const rows = [
      { id: "b1", stateId: STATE_ID, nodeId: null, title: "A", columns: [] },
    ];
    taskBoard.findMany.mockResolvedValueOnce(rows);

    const repo = new TasksRepository(prisma);
    const result = await repo.getBoards(STATE_ID);

    expect(result).toBe(rows);
    expect(taskBoard.findMany).toHaveBeenCalledTimes(1);
    expect(taskBoard.findMany).toHaveBeenCalledWith({
      where: { stateId: STATE_ID },
      include: {
        columns: {
          orderBy: { order: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  });

  it("getBoardById requires matching stateId and includes tasks with actor joins", async () => {
    const { prisma, taskBoard } = createMockPrisma();
    const row = {
      id: "b1",
      stateId: STATE_ID,
      nodeId: null,
      title: "A",
      columns: [],
    };
    taskBoard.findUnique.mockResolvedValueOnce(row);

    const repo = new TasksRepository(prisma);
    const result = await repo.getBoardById(STATE_ID, "b1");

    expect(result).toBe(row);
    expect(taskBoard.findUnique).toHaveBeenCalledWith({
      where: { id: "b1", stateId: STATE_ID },
      include: {
        columns: {
          orderBy: { order: "asc" },
          include: {
            tasks: {
              orderBy: { order: "asc" },
              include: {
                assignee: {
                  select: {
                    id: true,
                    handle: true,
                    displayName: true,
                    avatarUrl: true,
                  },
                },
                createdBy: {
                  select: {
                    id: true,
                    handle: true,
                    displayName: true,
                    avatarUrl: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it("getBoardById returns null when Prisma returns null (no row in this state)", async () => {
    const { prisma, taskBoard } = createMockPrisma();
    taskBoard.findUnique.mockResolvedValueOnce(null);

    const repo = new TasksRepository(prisma);
    const result = await repo.getBoardById(STATE_ID, "missing");
    expect(result).toBeNull();
  });

  it("createBoard seeds the three default columns with ascending order", async () => {
    const { prisma, taskBoard } = createMockPrisma();
    const created = {
      id: "b1",
      stateId: STATE_ID,
      nodeId: null,
      title: "New",
      columns: [],
    };
    taskBoard.create.mockResolvedValueOnce(created);

    const repo = new TasksRepository(prisma);
    const result = await repo.createBoard(STATE_ID, null, "New");

    expect(result).toBe(created);
    expect(taskBoard.create).toHaveBeenCalledWith({
      data: {
        stateId: STATE_ID,
        nodeId: null,
        title: "New",
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
  });

  it("createBoard passes through a non-null nodeId when provided", async () => {
    const { prisma, taskBoard } = createMockPrisma();
    taskBoard.create.mockResolvedValueOnce({
      id: "b1",
      stateId: STATE_ID,
      nodeId: "n-ministry",
      title: "N",
      columns: [],
    });

    const repo = new TasksRepository(prisma);
    await repo.createBoard(STATE_ID, "n-ministry", "N");

    expect(taskBoard.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ nodeId: "n-ministry" }),
      }),
    );
  });
});

// ------------------------------------------------------------
// Columns
// ------------------------------------------------------------

describe("TasksRepository — columns", () => {
  it("createColumn appends with order = max + 1", async () => {
    const { prisma, taskColumn } = createMockPrisma();
    taskColumn.findFirst.mockResolvedValueOnce({ id: "c-max", order: 4 });
    taskColumn.create.mockResolvedValueOnce({ id: "c-new", order: 5 });

    const repo = new TasksRepository(prisma);
    const result = await repo.createColumn("b1", "Review");

    expect(result).toEqual({ id: "c-new", order: 5 });
    expect(taskColumn.findFirst).toHaveBeenCalledWith({
      where: { boardId: "b1" },
      orderBy: { order: "desc" },
    });
    expect(taskColumn.create).toHaveBeenCalledWith({
      data: { boardId: "b1", title: "Review", order: 5 },
    });
  });

  it("createColumn uses order = 0 when the board has no columns yet", async () => {
    const { prisma, taskColumn } = createMockPrisma();
    taskColumn.findFirst.mockResolvedValueOnce(null);
    taskColumn.create.mockResolvedValueOnce({ id: "c-new", order: 0 });

    const repo = new TasksRepository(prisma);
    await repo.createColumn("b-empty", "First");

    expect(taskColumn.create).toHaveBeenCalledWith({
      data: { boardId: "b-empty", title: "First", order: 0 },
    });
  });

  it("updateColumnOrder writes the new order by primary key", async () => {
    const { prisma, taskColumn } = createMockPrisma();
    taskColumn.update.mockResolvedValueOnce({ id: "c1", order: 7 });

    const repo = new TasksRepository(prisma);
    await repo.updateColumnOrder("c1", 7);

    expect(taskColumn.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { order: 7 },
    });
  });
});

// ------------------------------------------------------------
// Tasks
// ------------------------------------------------------------

describe("TasksRepository — tasks", () => {
  it("createTask appends to the target column with order = max + 1", async () => {
    const { prisma, task } = createMockPrisma();
    task.findFirst.mockResolvedValueOnce({ id: "t-max", order: 2 });
    task.create.mockResolvedValueOnce({
      id: "t-new",
      boardId: "b1",
      columnId: "c1",
      order: 3,
    });

    const repo = new TasksRepository(prisma);
    const result = await repo.createTask(
      "b1",
      "c1",
      "u-author",
      "Ship it",
      "Body",
      "u-assignee",
    );

    expect(result).toMatchObject({ id: "t-new", order: 3 });
    expect(task.findFirst).toHaveBeenCalledWith({
      where: { columnId: "c1" },
      orderBy: { order: "desc" },
    });
    expect(task.create).toHaveBeenCalledWith({
      data: {
        boardId: "b1",
        columnId: "c1",
        createdById: "u-author",
        title: "Ship it",
        description: "Body",
        assigneeId: "u-assignee",
        order: 3,
      },
      include: {
        assignee: {
          select: {
            id: true,
            handle: true,
            displayName: true,
            avatarUrl: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            handle: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });
  });

  it("createTask uses order = 0 in an empty column and accepts a null assignee", async () => {
    const { prisma, task } = createMockPrisma();
    task.findFirst.mockResolvedValueOnce(null);
    task.create.mockResolvedValueOnce({
      id: "t-new",
      boardId: "b1",
      columnId: "c1",
      order: 0,
      assigneeId: null,
    });

    const repo = new TasksRepository(prisma);
    await repo.createTask("b1", "c1", "u-author", "T", "Desc", null);

    expect(task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ order: 0, assigneeId: null }),
      }),
    );
  });

  it("updateTask forwards the data patch and includes actor joins", async () => {
    const { prisma, task } = createMockPrisma();
    task.update.mockResolvedValueOnce({
      id: "t1",
      title: "T",
      columnId: "c2",
      order: 9,
    });

    const repo = new TasksRepository(prisma);
    const patch = {
      title: "T",
      description: "D",
      assigneeId: null,
      columnId: "c2",
      order: 9,
    };
    await repo.updateTask("t1", patch);

    expect(task.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: patch,
      include: {
        assignee: {
          select: {
            id: true,
            handle: true,
            displayName: true,
            avatarUrl: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            handle: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });
  });

  it("updateTask accepts a partial patch without injecting extra keys", async () => {
    const { prisma, task } = createMockPrisma();
    task.update.mockResolvedValueOnce({ id: "t1", title: "Renamed" });

    const repo = new TasksRepository(prisma);
    await repo.updateTask("t1", { title: "Renamed" });

    expect(task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "t1" },
        data: { title: "Renamed" },
      }),
    );
  });

  it("deleteTask calls prisma.task.delete by primary key", async () => {
    const { prisma, task } = createMockPrisma();
    task.delete.mockResolvedValueOnce({ id: "t1" });

    const repo = new TasksRepository(prisma);
    await repo.deleteTask("t1");

    expect(task.delete).toHaveBeenCalledWith({ where: { id: "t1" } });
  });
});

// ------------------------------------------------------------
// Error propagation
//
// The repo currently delegates to Prisma without catching. These
// tests DOCUMENT that behavior so a later change that adds a
// translation layer (e.g. P2025 → NOT_FOUND `KrwnError`) will
// necessarily update these tests — forcing the author to notice
// the contract shift. Until S1.2/S1.3 does that refactor, raw
// errors bubble up to the route layer.
// ------------------------------------------------------------

describe("TasksRepository — error propagation (current behavior)", () => {
  it("getBoards: rejections bubble up unchanged", async () => {
    const { prisma, taskBoard } = createMockPrisma();
    taskBoard.findMany.mockRejectedValueOnce(
      new Error("connection reset (P1017)"),
    );
    const repo = new TasksRepository(prisma);
    await expect(repo.getBoards(STATE_ID)).rejects.toThrow(
      /connection reset/,
    );
  });

  it("updateTask: 'record not found' rejections bubble up unchanged", async () => {
    const { prisma, task } = createMockPrisma();
    task.update.mockRejectedValueOnce(new Error("P2025 no such row"));
    const repo = new TasksRepository(prisma);
    await expect(
      repo.updateTask("missing", { title: "x" }),
    ).rejects.toThrow(/P2025/);
  });

  it("deleteTask: 'record not found' rejections bubble up unchanged", async () => {
    const { prisma, task } = createMockPrisma();
    task.delete.mockRejectedValueOnce(new Error("P2025 no such row"));
    const repo = new TasksRepository(prisma);
    await expect(repo.deleteTask("missing")).rejects.toThrow(/P2025/);
  });
});
