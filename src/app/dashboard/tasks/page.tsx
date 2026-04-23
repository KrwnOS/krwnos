import { KanbanWidget } from "@/components/tasks";

export default function TasksPage() {
  return (
    <div className="w-full h-[calc(100vh-64px)] overflow-hidden">
      <KanbanWidget />
    </div>
  );
}
