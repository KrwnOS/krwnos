import type { KrwnModule, ModuleContext, ModuleWidget } from "@krwnos/sdk";
import { TASK_PERMISSION_DESCRIPTORS, TASK_PERMISSIONS } from "./permissions";

export const coreTasksModule: KrwnModule = {
  slug: "core.tasks",
  name: "Tasks",
  version: "0.1.0",
  description: "Kanban-style task boards scoped to a State.",

  init() {
    return { permissions: TASK_PERMISSION_DESCRIPTORS };
  },

  getWidget(_ctx: ModuleContext): ModuleWidget {
    return {
      id: "tasks-kanban",
      title: "Kanban Board",
      component: "KanbanWidget",
      requiredPermission: TASK_PERMISSIONS.read,
      defaultSize: "lg",
    };
  },

  getSettings() {
    return null;
  },
};
