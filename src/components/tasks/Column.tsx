"use client";

import React, { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { IColumn } from "./KanbanBoard";
import { TaskCard } from "./TaskCard";

interface ColumnProps {
  column: IColumn;
  onAddTask?: (title: string, desc: string) => void;
}

export function Column({ column, onAddTask }: ColumnProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.id,
    data: { type: "Column", column },
  });

  const style = {
    transition,
    transform: CSS.Transform.toString(transform),
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTaskTitle.trim() && onAddTask) {
      onAddTask(newTaskTitle.trim(), "");
      setNewTaskTitle("");
      setIsAdding(false);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex flex-col flex-shrink-0 w-80 max-h-full rounded-2xl border border-white/5 bg-black/40 backdrop-blur-xl shadow-2xl overflow-hidden
        ${isDragging ? "opacity-50 ring-2 ring-primary" : "opacity-100"}`}
    >
      {/* Header */}
      <div 
        {...attributes} 
        {...listeners}
        className="flex items-center justify-between p-4 cursor-grab active:cursor-grabbing border-b border-white/5 bg-white/5"
      >
        <h3 className="font-semibold text-foreground/90 text-sm tracking-wide">{column.title}</h3>
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-black/50 text-xs font-medium text-white/50">
          {column.tasks.length}
        </span>
      </div>

      {/* Task List */}
      <div className="flex-1 p-3 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 space-y-3">
        <SortableContext items={column.tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {column.tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </SortableContext>

        {/* Add Task Quick Form */}
        {isAdding ? (
          <form onSubmit={handleAddSubmit} className="mt-2 p-3 bg-white/5 border border-white/10 rounded-xl">
            <input
              autoFocus
              type="text"
              placeholder="Task title..."
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none mb-3"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setIsAdding(false);
              }}
            />
            <div className="flex items-center justify-end gap-2">
              <button 
                type="button" 
                onClick={() => setIsAdding(false)}
                className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button 
                type="submit"
                disabled={!newTaskTitle.trim()}
                className="px-3 py-1 bg-primary text-primary-foreground text-xs font-medium rounded-lg disabled:opacity-50 transition-opacity"
              >
                Add
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 w-full p-2 text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 rounded-xl transition-all group mt-2"
          >
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-white/5 group-hover:bg-primary/20 group-hover:text-primary transition-colors">
              +
            </span>
            Add a card
          </button>
        )}
      </div>
    </div>
  );
}
