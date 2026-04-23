import { PermissionDescriptor } from "@krwnos/sdk";

export const TASK_PERMISSIONS = {
  read: "core.tasks.read",
  write: "core.tasks.write",
  admin: "core.tasks.admin",
} as const;

export const TASK_PERMISSION_DESCRIPTORS: PermissionDescriptor[] = [
  {
    key: "core.tasks.read",
    owner: "core.tasks",
    label: "View Tasks",
    description: "Allows reading tasks and boards in the Kanban module.",
  },
  {
    key: "core.tasks.write",
    owner: "core.tasks",
    label: "Edit Tasks",
    description: "Allows creating, moving, and editing tasks.",
  },
  {
    key: "core.tasks.admin",
    owner: "core.tasks",
    label: "Manage Boards",
    description: "Allows creating task boards and columns.",
  },
];
