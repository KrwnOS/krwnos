/**
 * Unit tests for `src/core/permissions-engine.ts`.
 *
 *   * Sovereign bypasses every check (reason: "sovereign", "*" in set).
 *   * Direct vs. inherited grants via `walkUp`.
 *   * Wildcard matches inside a domain (`finance.*`).
 *   * `isMemberOfNodeOrAncestor` walks both up and down.
 *   * `resolveAll` returns the union of permissions.
 */

import { describe, expect, it } from "vitest";
import {
  PermissionsEngine,
  permissionsEngine,
  type PermissionCheckInput,
} from "../permissions-engine";
import type { PermissionKey, VerticalSnapshot, VerticalNode } from "@/types/kernel";

// Tree:
//         root
//         /  \
//   parliament  military
//      |
//   subcommittee

function node(
  id: string,
  parentId: string | null,
  permissions: PermissionKey[],
  title = id,
): VerticalNode {
  const now = new Date();
  return {
    id,
    stateId: "s1",
    parentId,
    title,
    type: "position",
    permissions,
    order: 0,
    createdAt: now,
    updatedAt: now,
  };
}

const root = node("root", null, ["*"]);
const parliament = node("parliament", "root", [
  "finance.*" as PermissionKey,
  "state.configure" as PermissionKey,
]);
const subcommittee = node("subcommittee", "parliament", [
  "chat.post" as PermissionKey,
]);
const military = node("military", "root", [
  "military.command" as PermissionKey,
]);

function snapshot(
  memberships: Record<string, string[]>,
): VerticalSnapshot {
  const nodes = new Map<string, VerticalNode>([
    [root.id, root],
    [parliament.id, parliament],
    [subcommittee.id, subcommittee],
    [military.id, military],
  ]);
  const membershipsByUser = new Map<string, Set<string>>();
  for (const [user, ids] of Object.entries(memberships)) {
    membershipsByUser.set(user, new Set(ids));
  }
  return { stateId: "s1", nodes, membershipsByUser };
}

function input(overrides: Partial<PermissionCheckInput>): PermissionCheckInput {
  return {
    stateId: "s1",
    userId: "u_x",
    isOwner: false,
    snapshot: snapshot({}),
    ...overrides,
  } as PermissionCheckInput;
}

// ------------------------------------------------------------

describe("PermissionsEngine.can / check", () => {
  const eng = new PermissionsEngine();

  it("sovereign always wins", () => {
    const res = eng.check(
      input({ isOwner: true }),
      "finance.read" as PermissionKey,
    );
    expect(res).toEqual({ granted: true, reason: "sovereign" });
    expect(eng.can(input({ isOwner: true }), "anything" as PermissionKey)).toBe(
      true,
    );
  });

  it("no-membership guests are denied early", () => {
    const res = eng.check(input({}), "finance.read" as PermissionKey);
    expect(res.granted).toBe(false);
    expect(res.reason).toBe("no-membership");
  });

  it("direct grant at the node the user sits on", () => {
    const res = eng.check(
      input({
        userId: "u_p",
        snapshot: snapshot({ u_p: ["parliament"] }),
      }),
      "state.configure" as PermissionKey,
    );
    expect(res).toMatchObject({
      granted: true,
      reason: "direct",
      sourceNodeId: "parliament",
    });
  });

  it("inherited grant from an ancestor", () => {
    const res = eng.check(
      input({
        userId: "u_sub",
        snapshot: snapshot({ u_sub: ["subcommittee"] }),
      }),
      "finance.read" as PermissionKey,
    );
    expect(res.granted).toBe(true);
    expect(res.reason).toBe("inherited");
    // finance.* is on parliament, so that should be the source.
    expect(res.sourceNodeId).toBe("parliament");
  });

  it("denies when no chain contains the key", () => {
    // Build a fresh snapshot where root has no wildcard — otherwise the
    // implicit "*" at root would grant everything via inheritance.
    const rootNoStar = node("root", null, []);
    const mil = node("military", "root", [
      "military.command" as PermissionKey,
    ]);
    const nodes = new Map<string, VerticalNode>([
      [rootNoStar.id, rootNoStar],
      [mil.id, mil],
    ]);
    const membershipsByUser = new Map<string, Set<string>>([
      ["u_mil", new Set(["military"])],
    ]);
    const snap: VerticalSnapshot = {
      stateId: "s1",
      nodes,
      membershipsByUser,
    };
    const res = eng.check(
      input({ userId: "u_mil", snapshot: snap }),
      "finance.read" as PermissionKey,
    );
    expect(res).toEqual({ granted: false, reason: "denied" });
  });

  it("wildcard '*' at root propagates to everyone in the tree", () => {
    const res = eng.check(
      input({
        userId: "u_root",
        snapshot: snapshot({ u_root: ["root"] }),
      }),
      "anything.goes" as PermissionKey,
    );
    expect(res.granted).toBe(true);
    expect(res.sourceNodeId).toBe("root");
  });

  it("permissionless key short-circuits on missing domain", () => {
    // Isolated snapshot without a wildcard root — otherwise "*" at root
    // would grant the empty key via inheritance.
    const standalone = node("standalone", null, [
      "finance.read" as PermissionKey,
    ]);
    const nodes = new Map<string, VerticalNode>([
      [standalone.id, standalone],
    ]);
    const membershipsByUser = new Map<string, Set<string>>([
      ["u_s", new Set(["standalone"])],
    ]);
    const snap: VerticalSnapshot = {
      stateId: "s1",
      nodes,
      membershipsByUser,
    };
    const res = eng.check(
      input({ userId: "u_s", snapshot: snap }),
      "" as PermissionKey,
    );
    expect(res.granted).toBe(false);
  });
});

// ------------------------------------------------------------

describe("PermissionsEngine.resolveAll", () => {
  const eng = new PermissionsEngine();

  it("returns {'*'} for the Sovereign", () => {
    const set = eng.resolveAll(input({ isOwner: true }));
    expect(set.has("*" as PermissionKey)).toBe(true);
    expect(set.size).toBe(1);
  });

  it("unions every permission from every ancestor", () => {
    const set = eng.resolveAll(
      input({
        userId: "u_sub",
        snapshot: snapshot({ u_sub: ["subcommittee"] }),
      }),
    );
    expect(set.has("chat.post" as PermissionKey)).toBe(true);
    expect(set.has("finance.*" as PermissionKey)).toBe(true);
    expect(set.has("state.configure" as PermissionKey)).toBe(true);
    expect(set.has("*" as PermissionKey)).toBe(true);
  });

  it("returns an empty set for a user with no memberships", () => {
    const set = eng.resolveAll(input({}));
    expect(set.size).toBe(0);
  });
});

// ------------------------------------------------------------

describe("PermissionsEngine.isMemberOfNodeOrAncestor", () => {
  const eng = new PermissionsEngine();

  it("sovereign is always in scope", () => {
    const res = eng.isMemberOfNodeOrAncestor(
      { userId: "u", isOwner: true, snapshot: snapshot({}) },
      "subcommittee",
    );
    expect(res).toEqual({ granted: true, reason: "sovereign" });
  });

  it("direct member of the exact node", () => {
    const res = eng.isMemberOfNodeOrAncestor(
      {
        userId: "u_sub",
        isOwner: false,
        snapshot: snapshot({ u_sub: ["subcommittee"] }),
      },
      "subcommittee",
    );
    expect(res).toMatchObject({ granted: true, reason: "direct" });
  });

  it("inherited through an ancestor", () => {
    const res = eng.isMemberOfNodeOrAncestor(
      {
        userId: "u_p",
        isOwner: false,
        snapshot: snapshot({ u_p: ["parliament"] }),
      },
      "subcommittee",
    );
    expect(res).toMatchObject({ granted: true, reason: "inherited" });
    expect(res.sourceNodeId).toBe("parliament");
  });

  it("denies when the target node sits in a sibling branch", () => {
    const res = eng.isMemberOfNodeOrAncestor(
      {
        userId: "u_mil",
        isOwner: false,
        snapshot: snapshot({ u_mil: ["military"] }),
      },
      "subcommittee",
    );
    expect(res).toEqual({ granted: false, reason: "denied" });
  });

  it("denies when the user has no memberships at all", () => {
    const res = eng.isMemberOfNodeOrAncestor(
      { userId: "u", isOwner: false, snapshot: snapshot({}) },
      "subcommittee",
    );
    expect(res).toEqual({ granted: false, reason: "denied" });
  });
});

describe("permissionsEngine singleton", () => {
  it("is a shared instance", () => {
    expect(permissionsEngine).toBeInstanceOf(PermissionsEngine);
  });
});
