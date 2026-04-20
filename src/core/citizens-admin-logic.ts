/**
 * Pure permission helpers for citizen administration — unit-tested without Prisma.
 */

import { permissionsEngine } from "./permissions-engine";
import { InvitationPermissions } from "./invitations";
import { MembershipAdminPermissions } from "./membership-admin-permissions";
import type { PermissionKey, VerticalSnapshot } from "@/types/kernel";
import type { StateConfigAccessContext } from "./state-config";

const SCREEN_PERMISSIONS: PermissionKey[] = [
  MembershipAdminPermissions.Kick,
  MembershipAdminPermissions.Ban,
  MembershipAdminPermissions.Move,
  MembershipAdminPermissions.EditTitle,
  MembershipAdminPermissions.Merge,
  InvitationPermissions.Create,
];

function check(
  stateId: string,
  access: Pick<StateConfigAccessContext, "userId" | "isOwner">,
  snapshot: VerticalSnapshot,
  key: PermissionKey,
): boolean {
  return permissionsEngine.can(
    {
      stateId,
      userId: access.userId,
      isOwner: access.isOwner,
      snapshot,
    },
    key,
  );
}

/** Owner, global system.admin, or any citizen-admin / invite permission. */
export function canAccessCitizensAdminScreen(
  stateId: string,
  access: StateConfigAccessContext,
  snapshot: VerticalSnapshot,
): boolean {
  if (access.isOwner) return true;
  if (check(stateId, access, snapshot, "system.admin")) return true;
  for (const key of SCREEN_PERMISSIONS) {
    if (check(stateId, access, snapshot, key)) return true;
  }
  return false;
}

/**
 * Actor may act on resources scoped to `nodeId` if they are the sovereign,
 * hold the permission globally, AND sit on the vertical chain above that node.
 */
export function canActOnVerticalNode(
  stateId: string,
  access: Pick<StateConfigAccessContext, "userId" | "isOwner">,
  snapshot: VerticalSnapshot,
  nodeId: string,
  permission: PermissionKey,
): boolean {
  if (access.isOwner) return true;
  if (!check(stateId, access, snapshot, permission)) return false;
  return permissionsEngine.isMemberOfNodeOrAncestor(
    { userId: access.userId, isOwner: false, snapshot },
    nodeId,
  ).granted;
}

/** Admit / promote uses the same key as invite issuance. */
export function canAdmitToNode(
  stateId: string,
  access: StateConfigAccessContext,
  snapshot: VerticalSnapshot,
  targetNodeId: string,
): boolean {
  return canActOnVerticalNode(
    stateId,
    access,
    snapshot,
    targetNodeId,
    InvitationPermissions.Create,
  );
}

export function canKickOnNode(
  stateId: string,
  access: StateConfigAccessContext,
  snapshot: VerticalSnapshot,
  membershipNodeId: string,
): boolean {
  return canActOnVerticalNode(
    stateId,
    access,
    snapshot,
    membershipNodeId,
    MembershipAdminPermissions.Kick,
  );
}

export function canMoveFromNode(
  stateId: string,
  access: StateConfigAccessContext,
  snapshot: VerticalSnapshot,
  fromNodeId: string,
): boolean {
  return canActOnVerticalNode(
    stateId,
    access,
    snapshot,
    fromNodeId,
    MembershipAdminPermissions.Move,
  );
}

export function canMoveToNode(
  stateId: string,
  access: StateConfigAccessContext,
  snapshot: VerticalSnapshot,
  toNodeId: string,
): boolean {
  return canAdmitToNode(stateId, access, snapshot, toNodeId);
}

export function canEditTitleOnNode(
  stateId: string,
  access: StateConfigAccessContext,
  snapshot: VerticalSnapshot,
  membershipNodeId: string,
): boolean {
  return canActOnVerticalNode(
    stateId,
    access,
    snapshot,
    membershipNodeId,
    MembershipAdminPermissions.EditTitle,
  );
}

/** Ban / merge: sovereign-only keys — only owner passes in practice. */
export function canBanOrMerge(
  stateId: string,
  access: StateConfigAccessContext,
  snapshot: VerticalSnapshot,
  permission: typeof MembershipAdminPermissions.Ban | typeof MembershipAdminPermissions.Merge,
): boolean {
  if (access.isOwner) return true;
  return check(stateId, access, snapshot, permission);
}
