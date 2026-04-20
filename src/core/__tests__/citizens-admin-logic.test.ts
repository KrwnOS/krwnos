import { describe, expect, it } from "vitest";
import {
  canAccessCitizensAdminScreen,
  canActOnVerticalNode,
  canKickOnNode,
} from "../citizens-admin-logic";
import { MembershipAdminPermissions } from "../membership-admin-permissions";
import { InvitationPermissions } from "../invitations";
import type { PermissionKey, VerticalNode, VerticalSnapshot } from "@/types/kernel";
import type { StateConfigAccessContext } from "../state-config";

function snap(
  stateId: string,
  nodes: VerticalNode[],
  memberships: Record<string, string[]>,
): VerticalSnapshot {
  const membershipsByUser = new Map<string, Set<string>>();
  for (const [uid, ids] of Object.entries(memberships)) {
    membershipsByUser.set(uid, new Set(ids));
  }
  return {
    stateId,
    nodes: new Map(nodes.map((n) => [n.id, n])),
    membershipsByUser,
  };
}

function node(
  id: string,
  parentId: string | null,
  permissions: PermissionKey[],
): VerticalNode {
  return {
    id,
    stateId: "s1",
    parentId,
    title: id,
    type: "position",
    permissions,
    order: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("citizens-admin-logic", () => {
  it("canAccessCitizensAdminScreen allows owner", () => {
    const snapshot = snap("s1", [node("n1", null, [])], { u1: ["n1"] });
    const access: StateConfigAccessContext = {
      userId: "u1",
      isOwner: true,
      permissions: new Set(),
    };
    expect(canAccessCitizensAdminScreen("s1", access, snapshot)).toBe(true);
  });

  it("canAccessCitizensAdminScreen allows members.kick", () => {
    const snapshot = snap(
      "s1",
      [node("n1", null, [MembershipAdminPermissions.Kick])],
      { mod: ["n1"] },
    );
    const access: StateConfigAccessContext = {
      userId: "mod",
      isOwner: false,
      permissions: new Set<PermissionKey>([MembershipAdminPermissions.Kick]),
    };
    expect(canAccessCitizensAdminScreen("s1", access, snapshot)).toBe(true);
  });

  it("canAccessCitizensAdminScreen allows invitations.create", () => {
    const snapshot = snap(
      "s1",
      [node("n1", null, [InvitationPermissions.Create])],
      { mod: ["n1"] },
    );
    const access: StateConfigAccessContext = {
      userId: "mod",
      isOwner: false,
      permissions: new Set<PermissionKey>([InvitationPermissions.Create]),
    };
    expect(canAccessCitizensAdminScreen("s1", access, snapshot)).toBe(true);
  });

  it("canKickOnNode requires hierarchy + permission", () => {
    const snapshot = snap(
      "s1",
      [
        node("root", null, []),
        node("child", "root", [MembershipAdminPermissions.Kick]),
      ],
      { mod: ["child"] },
    );
    const access: StateConfigAccessContext = {
      userId: "mod",
      isOwner: false,
      permissions: new Set<PermissionKey>([MembershipAdminPermissions.Kick]),
    };
    expect(
      canKickOnNode("s1", access, snapshot, "child"),
    ).toBe(true);
    expect(
      canActOnVerticalNode(
        "s1",
        access,
        snapshot,
        "root",
        MembershipAdminPermissions.Kick,
      ),
    ).toBe(false);
  });
});
