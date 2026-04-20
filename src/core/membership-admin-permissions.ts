/**
 * Permission keys for citizen / membership administration.
 * Registered via `registerCorePermissions()` for the Vertical editor.
 */

import type { PermissionDescriptor, PermissionKey } from "@/types/kernel";

export const MembershipAdminPermissions = {
  Kick: "members.kick" as PermissionKey,
  Ban: "members.ban" as PermissionKey,
  Move: "members.move" as PermissionKey,
  EditTitle: "members.edit_title" as PermissionKey,
  Merge: "members.merge" as PermissionKey,
};

export const membershipAdminPermissionDescriptors: PermissionDescriptor[] = [
  {
    key: MembershipAdminPermissions.Kick,
    owner: "core",
    label: "Remove member from node",
    description:
      "Remove a user's membership from a vertical node (kick). Requires hierarchy access to that node.",
  },
  {
    key: MembershipAdminPermissions.Ban,
    owner: "core",
    label: "Ban citizen from state",
    description:
      "Remove all memberships in this state and block re-entry until the ban is revoked.",
    sovereignOnly: true,
  },
  {
    key: MembershipAdminPermissions.Move,
    owner: "core",
    label: "Move member between nodes",
    description:
      "Transfer a user from one vertical node to another within the same state.",
  },
  {
    key: MembershipAdminPermissions.EditTitle,
    owner: "core",
    label: "Edit membership title",
    description: "Change the personal title shown for a user within a node.",
  },
  {
    key: MembershipAdminPermissions.Merge,
    owner: "core",
    label: "Merge duplicate users",
    description:
      "Consolidate two user accounts in this state (irreversible; sovereign-only).",
    sovereignOnly: true,
  },
];
