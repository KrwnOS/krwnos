/**
 * Power Engine — иерархическое наследование прав.
 * ------------------------------------------------------------
 * Алгоритм:
 *   1. Находим все узлы вертикали, в которых состоит user.
 *   2. Для каждого узла поднимаемся вверх по parentId до корня,
 *      объединяя наборы permissions (union).
 *   3. Владелец State ("Суверен") имеет неявный "*" —
 *      супер-право, обходящее любые проверки.
 *
 * Engine НЕ знает о плагинах — он оперирует абстрактными
 * `PermissionKey`. Плагины регистрируют ключи через Registry
 * в своём `init()`.
 */

import type {
  PermissionKey,
  VerticalNode,
  VerticalSnapshot,
} from "@/types/kernel";

export interface PermissionCheckInput {
  stateId: string;
  userId: string;
  /** Whether the user is the Sovereign of this State. */
  isOwner: boolean;
  snapshot: VerticalSnapshot;
}

export interface PermissionCheckResult {
  granted: boolean;
  reason:
    | "sovereign"
    | "direct"
    | "inherited"
    | "denied"
    | "no-membership";
  /** Node id from which the permission was ultimately derived. */
  sourceNodeId?: string;
}

/**
 * PermissionsEngine resolves effective permissions of a user
 * inside a given State by walking the Vertical tree.
 *
 * It is intentionally stateless — cache snapshots outside.
 */
export class PermissionsEngine {
  /** Quick boolean check. */
  can(input: PermissionCheckInput, permission: PermissionKey): boolean {
    return this.check(input, permission).granted;
  }

  /** Detailed check with provenance (useful for audit logs). */
  check(
    input: PermissionCheckInput,
    permission: PermissionKey,
  ): PermissionCheckResult {
    if (input.isOwner) {
      return { granted: true, reason: "sovereign" };
    }

    const memberNodeIds =
      input.snapshot.membershipsByUser.get(input.userId) ?? new Set<string>();

    if (memberNodeIds.size === 0) {
      return { granted: false, reason: "no-membership" };
    }

    for (const nodeId of memberNodeIds) {
      const chain = this.walkUp(nodeId, input.snapshot);
      for (let i = 0; i < chain.length; i++) {
        const node = chain[i];
        if (!node) continue;
        if (this.nodeGrants(node, permission)) {
          return {
            granted: true,
            reason: i === 0 ? "direct" : "inherited",
            sourceNodeId: node.id,
          };
        }
      }
    }

    return { granted: false, reason: "denied" };
  }

  /**
   * Checks whether the user is a direct member of `nodeId` or of any
   * ancestor of it (walking `parentId` up to the root).
   *
   * Rationale: power in KrwnOS flows downwards — if the "Ministry of
   * Finance" is a parent of "Tax Office", members of the ministry
   * should naturally see everything scoped to the tax office,
   * including resources like chat channels that are bound to it.
   *
   * The Sovereign (`isOwner`) satisfies this check unconditionally.
   */
  isMemberOfNodeOrAncestor(
    input: Pick<PermissionCheckInput, "userId" | "isOwner" | "snapshot">,
    nodeId: string,
  ): { granted: boolean; sourceNodeId?: string; reason: "sovereign" | "direct" | "inherited" | "denied" } {
    if (input.isOwner) return { granted: true, reason: "sovereign" };

    const userNodes = input.snapshot.membershipsByUser.get(input.userId);
    if (!userNodes || userNodes.size === 0) {
      return { granted: false, reason: "denied" };
    }

    if (userNodes.has(nodeId)) {
      return { granted: true, reason: "direct", sourceNodeId: nodeId };
    }

    // Walk the chain from nodeId up — if any ancestor is in the user's
    // membership set, access is granted through inheritance.
    const visited = new Set<string>();
    let cursor: string | null | undefined = input.snapshot.nodes.get(nodeId)?.parentId ?? null;
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      if (userNodes.has(cursor)) {
        return { granted: true, reason: "inherited", sourceNodeId: cursor };
      }
      cursor = input.snapshot.nodes.get(cursor)?.parentId ?? null;
    }

    return { granted: false, reason: "denied" };
  }

  /** Compute the full set of permissions a user effectively has. */
  resolveAll(input: PermissionCheckInput): Set<PermissionKey> {
    const result = new Set<PermissionKey>();
    if (input.isOwner) {
      result.add("*");
      return result;
    }

    const memberNodeIds =
      input.snapshot.membershipsByUser.get(input.userId) ?? new Set<string>();

    for (const nodeId of memberNodeIds) {
      for (const node of this.walkUp(nodeId, input.snapshot)) {
        for (const perm of node.permissions) {
          result.add(perm);
        }
      }
    }
    return result;
  }

  // ----------------------------------------------------------
  // internals
  // ----------------------------------------------------------

  /**
   * Returns the node itself followed by all ancestors up to the
   * root. Guards against accidental cycles (shouldn't happen, but
   * graph integrity bugs deserve a safety net).
   */
  private walkUp(
    startId: string,
    snapshot: VerticalSnapshot,
  ): VerticalNode[] {
    const chain: VerticalNode[] = [];
    const visited = new Set<string>();
    let cursor: string | null = startId;

    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      const node = snapshot.nodes.get(cursor);
      if (!node) break;
      chain.push(node);
      cursor = node.parentId;
    }

    return chain;
  }

  private nodeGrants(node: VerticalNode, permission: PermissionKey): boolean {
    if (node.permissions.includes("*")) return true;
    if (node.permissions.includes(permission)) return true;

    // Wildcard within a domain: "finance.*" grants "finance.read".
    const [domain] = permission.split(".");
    if (!domain) return false;
    const domainWildcard = `${domain}.*` as PermissionKey;
    return node.permissions.includes(domainWildcard);
  }
}

/** Singleton convenience — the engine holds no state. */
export const permissionsEngine = new PermissionsEngine();
