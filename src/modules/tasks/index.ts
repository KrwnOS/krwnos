import { KrwnModule, ModuleContext } from "@krwnos/sdk";
import { TASK_PERMISSION_DESCRIPTORS } from "./permissions";

export const coreTasksModule: KrwnModule = {
  manifest: {
    slug: "core.tasks",
    version: "0.1.0",
    permissions: TASK_PERMISSION_DESCRIPTORS,
  },

  async bootstrap(ctx: ModuleContext) {
    ctx.logger.info("core.tasks bootstrapped");
  },

  getWidget() {
    return {
      id: "tasks-kanban",
      title: "Kanban Board",
      component: "KanbanWidget",
      defaultPosition: { w: 12, h: 8 },
    };
  },
};
