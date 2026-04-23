/**
 * Unit tests for `TasksRepository` with a mocked `ModuleDatabase`.
 * The repo runs raw SQL inside `db.transaction` — these tests pin
 * the query shapes and the ordering / INSERT logic.
 */

import { describe, expect, it, vi } from "vitest";
import type { ModuleDatabase } from "@krwnos/sdk";
import { TasksRepository } from "../repo";

const STATE_ID = "s1";

function createMockDb() {
  const queryRaw = vi.fn();
  const executeRaw = vi.fn();
  const db: ModuleDatabase = {
    transaction: vi.fn(async (fn) => fn({ queryRaw, executeRaw })),
  };
  return { db, queryRaw, executeRaw, transaction: db.transaction };
}

describe("TasksRepository — boards", () => {
  it("getBoards scopes by stateId, loads columns per board", async () => {
    const { db, queryRaw } = createMockDb();
    const board = {
      id: "b1",
      stateId: STATE_ID,
      nodeId: null,
      title: "A",
    };
    queryRaw
      .mockResolvedValueOnce([board])
      .mockResolvedValueOnce([]);

    const repo = new TasksRepository(db);
    const result = await repo.getBoards(STATE_ID);

    expect(result).toEqual([{ ...board, columns: [] }]);
    expect(queryRaw).toHaveBeenNthCalledWith(
      1,
      'SELECT * FROM "TaskBoard" WHERE "stateId" = $1 ORDER BY "createdAt" ASC',
      STATE_ID,
    );
    expect(queryRaw).toHaveBeenNthCalledWith(
      2,
      'SELECT * FROM "TaskColumn" WHERE "boardId" = $1 ORDER BY "order" ASC',
      "b1",
    );
  });

  it("getBoardById returns board with columns and tasks", async () => {
    const { db, queryRaw } = createMockDb();
    const board = {
      id: "b1",
      stateId: STATE_ID,
      nodeId: null,
      title: "A",
    };
    const col = { id: "c1", boardId: "b1" };
    const task = { id: "t1", columnId: "c1" };
    queryRaw
      .mockResolvedValueOnce([board])
      .mockResolvedValueOnce([col])
      .mockResolvedValueOnce([task]);

    const repo = new TasksRepository(db);
    const result = await repo.getBoardById(STATE_ID, "b1");

    expect(result).toEqual({
      ...board,
      columns: [{ ...col, tasks: [task] }],
    });
  });

  it("getBoardById returns null when no board row", async () => {
    const { db, queryRaw } = createMockDb();
    queryRaw.mockResolvedValueOnce([]);

    const repo = new TasksRepository(db);
    const result = await repo.getBoardById(STATE_ID, "missing");
    expect(result).toBeNull();
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("createBoard seeds three default columns and returns composed board", async () => {
    const { db, executeRaw } = createMockDb();
    const repo = new TasksRepository(db);
    const result = await repo.createBoard(STATE_ID, null, "New");

    expect(executeRaw).toHaveBeenCalled();
    const insertCalls = executeRaw.mock.calls.map((c) => c[0] as string);
    expect(insertCalls.filter((q) => q.includes("TaskBoard"))).toHaveLength(1);
    expect(insertCalls.filter((q) => q.includes("TaskColumn"))).toHaveLength(3);
    expect(result).toMatchObject({
      stateId: STATE_ID,
      nodeId: null,
      title: "New",
    });
    expect(result.columns).toHaveLength(3);
    expect(result.columns![0]!.order).toBe(0);
    expect(result.columns![1]!.order).toBe(1);
    expect(result.columns![2]!.order).toBe(2);
  });

  it("createBoard passes non-null nodeId", async () => {
    const { db, executeRaw } = createMockDb();
    const repo = new TasksRepository(db);
    await repo.createBoard(STATE_ID, "n-ministry", "N");

    const boardCall = executeRaw.mock.calls.find((c) =>
      String(c[0]).includes("TaskBoard"),
    );
    expect(boardCall).toBeDefined();
    expect(boardCall).toEqual(
      expect.arrayContaining([
        expect.stringContaining("INSERT INTO"),
        expect.any(String),
        STATE_ID,
        "n-ministry",
        "N",
        expect.any(Date),
        expect.any(Date),
      ]),
    );
  });
});

describe("TasksRepository — columns", () => {
  it("createColumn appends with order = max + 1", async () => {
    const { db, queryRaw, executeRaw } = createMockDb();
    queryRaw.mockResolvedValueOnce([{ max_order: 4 }]);

    const repo = new TasksRepository(db);
    const result = await repo.createColumn("b1", "Review");

    expect(queryRaw).toHaveBeenCalledWith(
      'SELECT MAX("order") as max_order FROM "TaskColumn" WHERE "boardId" = $1',
      "b1",
    );
    expect(executeRaw).toHaveBeenCalled();
    const insert = executeRaw.mock.calls[0]!;
    expect(insert[0]).toContain("INSERT INTO");
    expect(insert[4]).toBe(5);
    expect(result).toMatchObject({ boardId: "b1", title: "Review", order: 5 });
  });

  it("createColumn uses order = 0 when the board has no columns yet", async () => {
    const { db, queryRaw } = createMockDb();
    queryRaw.mockResolvedValueOnce([{ max_order: null }]);

    const repo = new TasksRepository(db);
    const result = await repo.createColumn("b-empty", "First");
    expect(result?.order).toBe(0);
  });

  it("updateColumnOrder updates then loads the row", async () => {
    const { db, queryRaw, executeRaw } = createMockDb();
    const col = { id: "c1", order: 7 };
    queryRaw.mockResolvedValueOnce([col]);

    const repo = new TasksRepository(db);
    const result = await repo.updateColumnOrder("c1", 7);

    expect(executeRaw).toHaveBeenCalledWith(
      'UPDATE "TaskColumn" SET "order" = $1, "updatedAt" = $2 WHERE "id" = $3',
      7,
      expect.any(Date),
      "c1",
    );
    expect(result).toEqual(col);
  });
});

describe("TasksRepository — tasks", () => {
  it("createTask appends to the target column with order = max + 1", async () => {
    const { db, queryRaw } = createMockDb();
    queryRaw.mockResolvedValueOnce([{ max_order: 2 }]);

    const repo = new TasksRepository(db);
    const result = await repo.createTask(
      "b1",
      "c1",
      "u-author",
      "Ship it",
      "Body",
      "u-assignee",
    );

    expect(queryRaw).toHaveBeenCalledWith(
      'SELECT MAX("order") as max_order FROM "Task" WHERE "columnId" = $1',
      "c1",
    );
    expect(result).toMatchObject({
      boardId: "b1",
      columnId: "c1",
      createdById: "u-author",
      title: "Ship it",
      description: "Body",
      assigneeId: "u-assignee",
      order: 3,
    });
  });

  it("createTask uses order = 0 in an empty column and accepts a null assignee", async () => {
    const { db, queryRaw } = createMockDb();
    queryRaw.mockResolvedValueOnce([{ max_order: null }]);

    const repo = new TasksRepository(db);
    const result = await repo.createTask("b1", "c1", "u-author", "T", "Desc", null);
    expect(result.order).toBe(0);
    expect(result.assigneeId).toBeNull();
  });

  it("updateTask with empty patch selects only", async () => {
    const { db, queryRaw } = createMockDb();
    const row = { id: "t1", title: "T" };
    queryRaw.mockResolvedValueOnce([row]);

    const repo = new TasksRepository(db);
    const out = await repo.updateTask("t1", {});

    expect(out).toEqual(row);
    expect(queryRaw).toHaveBeenCalledWith('SELECT * FROM "Task" WHERE "id" = $1', "t1");
  });

  it("updateTask with patch runs UPDATE — RETURNING", async () => {
    const { db, queryRaw } = createMockDb();
    const row = { id: "t1", title: "T", order: 9 };
    queryRaw.mockResolvedValueOnce([row]);

    const repo = new TasksRepository(db);
    const out = await repo.updateTask("t1", { title: "T", order: 9 });

    expect(out).toEqual(row);
    const call = queryRaw.mock.calls[0]!;
    expect(call[0]).toContain("UPDATE");
    expect(call[0]).toContain("RETURNING");
  });

  it("deleteTask loads row then deletes it", async () => {
    const { db, queryRaw, executeRaw } = createMockDb();
    const row = { id: "t1" };
    queryRaw.mockResolvedValueOnce([row]);

    const repo = new TasksRepository(db);
    const out = await repo.deleteTask("t1");

    expect(out).toEqual(row);
    expect(executeRaw).toHaveBeenCalledWith('DELETE FROM "Task" WHERE "id" = $1', "t1");
  });
});

describe("TasksRepository — error propagation (current behavior)", () => {
  it("getBoards: rejections bubble up unchanged", async () => {
    const { db, queryRaw } = createMockDb();
    queryRaw.mockRejectedValueOnce(new Error("connection reset (P1017)"));
    const repo = new TasksRepository(db);
    await expect(repo.getBoards(STATE_ID)).rejects.toThrow(/connection reset/);
  });

  it("updateTask: empty select with no row throws P2025-style message", async () => {
    const { db, queryRaw } = createMockDb();
    queryRaw.mockResolvedValueOnce([]);
    const repo = new TasksRepository(db);
    await expect(repo.updateTask("missing", {})).rejects.toThrow(/P2025/);
  });

  it("deleteTask: no row throws P2025-style message", async () => {
    const { db, queryRaw } = createMockDb();
    queryRaw.mockResolvedValueOnce([]);
    const repo = new TasksRepository(db);
    await expect(repo.deleteTask("missing")).rejects.toThrow(/P2025/);
  });
});
