"use client";

import React, { useEffect, useState } from "react";
import { KanbanBoard, IColumn, ITask } from "./KanbanBoard";

export function KanbanWidget() {
  const [columns, setColumns] = useState<IColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [boardId, setBoardId] = useState<string | null>(null);

  useEffect(() => {
    fetchBoards();
  }, []);

  const fetchBoards = async () => {
    try {
      const res = await fetch("/api/tasks/boards");
      if (res.ok) {
        const data = await res.json();
        const boards = data.boards;
        
        if (boards && boards.length > 0) {
          const board = boards[0];
          setBoardId(board.id);
          // Transform to frontend model
          const mappedCols = board.columns.map((c: any) => ({
            id: c.id,
            title: c.title,
            tasks: c.tasks.map((t: any) => ({
              id: t.id,
              columnId: t.columnId,
              title: t.title,
              description: t.description,
              assignee: t.assignee,
            })),
          }));
          setColumns(mappedCols);
        } else {
          // No boards exist, let's create a default one
          await createDefaultBoard();
        }
      }
    } catch (err) {
      console.error("Failed to fetch boards", err);
    } finally {
      setLoading(false);
    }
  };

  const createDefaultBoard = async () => {
    try {
      const res = await fetch("/api/tasks/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Main Board" }),
      });
      if (res.ok) {
        const data = await res.json();
        setBoardId(data.board.id);
        const mappedCols = data.board.columns.map((c: any) => ({
          id: c.id,
          title: c.title,
          tasks: [],
        }));
        setColumns(mappedCols);
      }
    } catch (err) {
      console.error("Failed to create default board", err);
    }
  };

  const handleTaskCreate = async (columnId: string, title: string, description: string) => {
    if (!boardId) return;
    try {
      const res = await fetch("/api/tasks/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardId, columnId, title, description }),
      });
      if (res.ok) {
        const data = await res.json();
        const newTask: ITask = {
          id: data.task.id,
          columnId: data.task.columnId,
          title: data.task.title,
          description: data.task.description,
          assignee: data.task.assignee,
        };
        
        // Optimistic update
        setColumns((prev) => 
          prev.map(c => c.id === columnId ? { ...c, tasks: [...c.tasks, newTask] } : c)
        );
      }
    } catch (err) {
      console.error("Failed to create task", err);
    }
  };

  const handleTaskMove = async (taskId: string, newColumnId: string, newIndex: number) => {
    if (!boardId) return;
    try {
      await fetch(`/api/tasks/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardId, columnId: newColumnId, order: newIndex }),
      });
      // The UI has already optimistically moved it via KanbanBoard state
    } catch (err) {
      console.error("Failed to move task", err);
      // Ideally rollback optimistic update here
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center w-full h-full min-h-[400px]">
        <div className="animate-pulse flex gap-4">
          <div className="w-80 h-96 bg-white/5 rounded-2xl" />
          <div className="w-80 h-96 bg-white/5 rounded-2xl" />
          <div className="w-80 h-96 bg-white/5 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full min-h-[500px] p-6 bg-gradient-to-br from-background via-background/90 to-black relative">
      {/* Decorative ambient background */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/20 blur-[120px] rounded-full mix-blend-screen opacity-50 animate-pulse" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-accent/20 blur-[150px] rounded-full mix-blend-screen opacity-50" />
      </div>
      
      <div className="relative z-10 w-full h-full flex flex-col">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-white/90 drop-shadow-md">Tasks</h2>
            <p className="text-sm text-white/50 mt-1">Manage your state operations.</p>
          </div>
          <button className="px-4 py-2 bg-white/10 hover:bg-white/15 text-white/90 text-sm font-medium rounded-xl border border-white/10 backdrop-blur-md transition-all shadow-lg active:scale-95">
            + New Board
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          <KanbanBoard 
            initialColumns={columns} 
            onTaskMove={handleTaskMove}
            onTaskCreate={handleTaskCreate}
          />
        </div>
      </div>
    </div>
  );
}
