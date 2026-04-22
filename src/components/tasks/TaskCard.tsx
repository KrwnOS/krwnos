"use client";

import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ITask } from "./KanbanBoard";

interface TaskCardProps {
  task: ITask;
  isOverlay?: boolean;
}

export function TaskCard({ task, isOverlay }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "Task", task },
  });

  const style = {
    transition,
    transform: CSS.Transform.toString(transform),
  };

  if (isDragging && !isOverlay) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="w-full h-24 rounded-xl border border-primary/50 bg-primary/10 opacity-30"
      />
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`relative flex flex-col gap-2 p-4 rounded-xl border bg-card/80 backdrop-blur-md shadow-sm cursor-grab active:cursor-grabbing hover:border-white/20 transition-colors
        ${isOverlay ? "rotate-2 scale-105 shadow-2xl border-white/20 ring-1 ring-primary/50" : "border-white/5"}
      `}
    >
      <div className="flex justify-between items-start gap-2">
        <h4 className="text-sm font-medium leading-snug text-foreground/90 break-words">{task.title}</h4>
        
        {/* Mock context menu button */}
        <button className="flex items-center justify-center w-6 h-6 rounded-md hover:bg-white/10 text-white/40 hover:text-white transition-colors shrink-0 -mt-1 -mr-1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="1"/>
            <circle cx="19" cy="12" r="1"/>
            <circle cx="5" cy="12" r="1"/>
          </svg>
        </button>
      </div>

      {task.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{task.description}</p>
      )}

      {/* Footer (Assignee, Tags, etc.) */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-2">
          {/* Mock priority/tag indicator */}
          <span className="w-8 h-1 rounded-full bg-blue-500/50" />
          <span className="w-8 h-1 rounded-full bg-purple-500/50" />
        </div>
        
        {task.assignee ? (
          <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-primary/80 to-accent/80 flex items-center justify-center shadow-inner overflow-hidden ring-1 ring-white/10">
            {task.assignee.avatarUrl ? (
              <img src={task.assignee.avatarUrl} alt={task.assignee.handle} className="w-full h-full object-cover" />
            ) : (
              <span className="text-[10px] font-bold text-white uppercase">{task.assignee.handle.charAt(0)}</span>
            )}
          </div>
        ) : (
          <div className="w-6 h-6 rounded-full bg-white/5 border border-white/10 border-dashed flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/30">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
