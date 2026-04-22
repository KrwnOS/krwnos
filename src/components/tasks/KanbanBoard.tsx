"use client";

import React, { useState, useEffect } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Column } from "./Column";
import { TaskCard } from "./TaskCard";

export interface ITask {
  id: string;
  columnId: string;
  title: string;
  description: string;
  assignee?: {
    id: string;
    handle: string;
    avatarUrl?: string;
  };
}

export interface IColumn {
  id: string;
  title: string;
  tasks: ITask[];
}

interface KanbanBoardProps {
  initialColumns: IColumn[];
  onTaskMove: (taskId: string, newColumnId: string, newIndex: number) => void;
  onTaskCreate?: (columnId: string, title: string, description: string) => void;
}

export function KanbanBoard({ initialColumns, onTaskMove, onTaskCreate }: KanbanBoardProps) {
  const [columns, setColumns] = useState<IColumn[]>(initialColumns);
  const [activeTask, setActiveTask] = useState<ITask | null>(null);

  // Sync state if props change (e.g. initial load finishes)
  useEffect(() => {
    setColumns(initialColumns);
  }, [initialColumns]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 }, // 5px movement before drag starts
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const task = columns.flatMap((c) => c.tasks).find((t) => t.id === active.id);
    if (task) setActiveTask(task);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    if (activeId === overId) return;

    // Find columns
    const activeColumn = columns.find((c) => c.tasks.some((t) => t.id === activeId));
    const overColumn = columns.find((c) => c.id === overId || c.tasks.some((t) => t.id === overId));

    if (!activeColumn || !overColumn) return;

    if (activeColumn.id !== overColumn.id) {
      setColumns((prev) => {
        const activeItems = activeColumn.tasks;
        const overItems = overColumn.tasks;
        const activeIndex = activeItems.findIndex((t) => t.id === activeId);
        const overIndex = overItems.findIndex((t) => t.id === overId);

        let newIndex;
        if (over.id in prev.map(c => c.id)) {
          // Hovering over an empty column
          newIndex = overItems.length + 1;
        } else {
          const isBelowOverItem =
            over &&
            active.rect.current.translated &&
            active.rect.current.translated.top > over.rect.top + over.rect.height;
          const modifier = isBelowOverItem ? 1 : 0;
          newIndex = overIndex >= 0 ? overIndex + modifier : overItems.length + 1;
        }

        return prev.map((c) => {
          if (c.id === activeColumn.id) {
            return { ...c, tasks: activeItems.filter((t) => t.id !== activeId) };
          }
          if (c.id === overColumn.id) {
            const newTasks = [...overItems];
            newTasks.splice(newIndex, 0, { ...activeItems[activeIndex], columnId: overColumn.id });
            return { ...c, tasks: newTasks };
          }
          return c;
        });
      });
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    const activeColumn = columns.find((c) => c.tasks.some((t) => t.id === activeId));
    const overColumn = columns.find((c) => c.id === overId || c.tasks.some((t) => t.id === overId));

    if (!activeColumn || !overColumn) return;

    const activeIndex = activeColumn.tasks.findIndex((t) => t.id === activeId);
    const overIndex = overColumn.tasks.findIndex((t) => t.id === overId);

    if (activeColumn.id === overColumn.id) {
      if (activeIndex !== overIndex) {
        setColumns((prev) => {
          return prev.map((c) => {
            if (c.id === activeColumn.id) {
              return { ...c, tasks: arrayMove(c.tasks, activeIndex, overIndex) };
            }
            return c;
          });
        });
        onTaskMove(activeId, activeColumn.id, overIndex);
      }
    } else {
      // The actual move across columns is handled in handleDragOver for smooth UI,
      // but we need to notify the backend here.
      onTaskMove(activeId, overColumn.id, overIndex >= 0 ? overIndex : overColumn.tasks.length);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex w-full h-full gap-6 overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-white/10">
        <SortableContext items={columns.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
          {columns.map((col) => (
            <Column 
              key={col.id} 
              column={col} 
              onAddTask={(title, desc) => onTaskCreate?.(col.id, title, desc)} 
            />
          ))}
        </SortableContext>
      </div>

      <DragOverlay>
        {activeTask ? <TaskCard task={activeTask} isOverlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}
