import type { ModuleDatabase } from "@krwnos/sdk";

/**
 * TasksRepository operates purely through ModuleDatabase (raw SQL in the sandboxed schema).
 * User data enrichment (handle, displayName, avatarUrl) is handled by the service layer,
 * which has access to the full Prisma client for cross-schema queries.
 *
 * All database operations run within a transaction that has search_path set to the module's
 * schema, ensuring isolation from the public schema tables.
 */
export class TasksRepository {
  constructor(private readonly db: ModuleDatabase) {}

  async getBoards(stateId: string) {
    return this.db.transaction(async (tx) => {
      const boards = await tx.queryRaw<any>(
        "SELECT * FROM \"TaskBoard\" WHERE \"stateId\" = $1 ORDER BY \"createdAt\" ASC",
        stateId
      );

      const boardsWithColumns = await Promise.all(
        boards.map(async (board) => {
          const columns = await tx.queryRaw<any>(
            "SELECT * FROM \"TaskColumn\" WHERE \"boardId\" = $1 ORDER BY \"order\" ASC",
            board.id
          );
          return { ...board, columns };
        })
      );

      return boardsWithColumns;
    });
  }

  async getBoardById(stateId: string, boardId: string) {
    return this.db.transaction(async (tx) => {
      const boards = await tx.queryRaw<any>(
        "SELECT * FROM \"TaskBoard\" WHERE \"id\" = $1 AND \"stateId\" = $2",
        boardId,
        stateId
      );

      if (boards.length === 0) return null;

      const board = boards[0];
      const columns = await tx.queryRaw<any>(
        "SELECT * FROM \"TaskColumn\" WHERE \"boardId\" = $1 ORDER BY \"order\" ASC",
        boardId
      );

      const columnsWithTasks = await Promise.all(
        columns.map(async (column) => {
          const tasks = await tx.queryRaw<any>(
            "SELECT * FROM \"Task\" WHERE \"columnId\" = $1 ORDER BY \"order\" ASC",
            column.id
          );
          return { ...column, tasks };
        })
      );

      return { ...board, columns: columnsWithTasks };
    });
  }

  async createBoard(stateId: string, nodeId: string | null, title: string) {
    return this.db.transaction(async (tx) => {
      const boardId = this.generateId();
      const now = new Date();

      await tx.executeRaw(
        "INSERT INTO \"TaskBoard\" (\"id\", \"stateId\", \"nodeId\", \"title\", \"createdAt\", \"updatedAt\") VALUES ($1, $2, $3, $4, $5, $6)",
        boardId,
        stateId,
        nodeId,
        title,
        now,
        now
      );

      const columns = await Promise.all([
        { title: "To Do", order: 0 },
        { title: "In Progress", order: 1 },
        { title: "Done", order: 2 },
      ].map(async (col, idx) => {
        const colId = this.generateId();
        await tx.executeRaw(
          "INSERT INTO \"TaskColumn\" (\"id\", \"boardId\", \"title\", \"order\", \"createdAt\", \"updatedAt\") VALUES ($1, $2, $3, $4, $5, $6)",
          colId,
          boardId,
          col.title,
          idx,
          now,
          now
        );
        return { id: colId, boardId, title: col.title, order: idx, createdAt: now, updatedAt: now };
      }));

      return { id: boardId, stateId, nodeId, title, columns, createdAt: now, updatedAt: now };
    });
  }

  async createColumn(boardId: string, title: string) {
    return this.db.transaction(async (tx) => {
      const maxOrderRows = await tx.queryRaw<{ max_order: number | null }>(
        "SELECT MAX(\"order\") as max_order FROM \"TaskColumn\" WHERE \"boardId\" = $1",
        boardId
      );

      const order = (maxOrderRows[0]?.max_order ?? -1) + 1;
      const colId = this.generateId();
      const now = new Date();

      await tx.executeRaw(
        "INSERT INTO \"TaskColumn\" (\"id\", \"boardId\", \"title\", \"order\", \"createdAt\", \"updatedAt\") VALUES ($1, $2, $3, $4, $5, $6)",
        colId,
        boardId,
        title,
        order,
        now,
        now
      );

      return { id: colId, boardId, title, order, createdAt: now, updatedAt: now };
    });
  }

  async updateColumnOrder(columnId: string, order: number) {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      await tx.executeRaw(
        "UPDATE \"TaskColumn\" SET \"order\" = $1, \"updatedAt\" = $2 WHERE \"id\" = $3",
        order,
        now,
        columnId
      );

      const rows = await tx.queryRaw<any>(
        "SELECT * FROM \"TaskColumn\" WHERE \"id\" = $1",
        columnId
      );

      return rows[0] || null;
    });
  }

  async createTask(
    boardId: string,
    columnId: string,
    createdById: string,
    title: string,
    description: string,
    assigneeId: string | null
  ) {
    return this.db.transaction(async (tx) => {
      const maxOrderRows = await tx.queryRaw<{ max_order: number | null }>(
        "SELECT MAX(\"order\") as max_order FROM \"Task\" WHERE \"columnId\" = $1",
        columnId
      );

      const order = (maxOrderRows[0]?.max_order ?? -1) + 1;
      const taskId = this.generateId();
      const now = new Date();

      await tx.executeRaw(
        "INSERT INTO \"Task\" (\"id\", \"boardId\", \"columnId\", \"createdById\", \"title\", \"description\", \"assigneeId\", \"order\", \"createdAt\", \"updatedAt\") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        taskId,
        boardId,
        columnId,
        createdById,
        title,
        description,
        assigneeId,
        order,
        now,
        now
      );

      return {
        id: taskId,
        boardId,
        columnId,
        createdById,
        title,
        description,
        assigneeId,
        order,
        createdAt: now,
        updatedAt: now,
      };
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
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const updates: string[] = [];
      const values: unknown[] = [];
      let paramNum = 1;

      if (data.title !== undefined) {
        updates.push(`"title" = $${paramNum++}`);
        values.push(data.title);
      }
      if (data.description !== undefined) {
        updates.push(`"description" = $${paramNum++}`);
        values.push(data.description);
      }
      if (data.assigneeId !== undefined) {
        updates.push(`"assigneeId" = $${paramNum++}`);
        values.push(data.assigneeId);
      }
      if (data.columnId !== undefined) {
        updates.push(`"columnId" = $${paramNum++}`);
        values.push(data.columnId);
      }
      if (data.order !== undefined) {
        updates.push(`"order" = $${paramNum++}`);
        values.push(data.order);
      }

      if (updates.length === 0) {
        const rows = await tx.queryRaw<any>(
          "SELECT * FROM \"Task\" WHERE \"id\" = $1",
          taskId
        );
        if (rows.length === 0) throw new Error("P2025 no such row");
        return rows[0];
      }

      updates.push(`"updatedAt" = $${paramNum++}`);
      values.push(now);
      values.push(taskId);

      const sql = `UPDATE "Task" SET ${updates.join(", ")} WHERE "id" = $${paramNum} RETURNING *`;
      const rows = await tx.queryRaw<any>(sql, ...values);

      if (rows.length === 0) throw new Error("P2025 no such row");

      return rows[0];
    });
  }

  async deleteTask(taskId: string) {
    return this.db.transaction(async (tx) => {
      const rows = await tx.queryRaw<any>(
        "SELECT * FROM \"Task\" WHERE \"id\" = $1",
        taskId
      );

      if (rows.length === 0) throw new Error("P2025 no such row");

      await tx.executeRaw("DELETE FROM \"Task\" WHERE \"id\" = $1", taskId);

      return rows[0];
    });
  }

  private generateId(): string {
    return `${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
  }
}
