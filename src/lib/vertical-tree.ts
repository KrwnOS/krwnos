/**
 * Pure helpers for Vertical admin tree: cycle checks, lobby rules,
 * sibling reorder, reparent. Used by the atomic tree API and the
 * vertical-editor UI (preview before save).
 */

export type VerticalTreeErrorCode =
  | "cycle"
  | "lobby_reparent"
  | "id_mismatch"
  | "unknown_parent";

export interface VerticalTreeNodeShape {
  id: string;
  parentId: string | null;
  order: number;
  isLobby: boolean;
  /** ISO createdAt for stable sibling sort */
  createdAt: string;
}

export interface VerticalTreeValidationError {
  code: VerticalTreeErrorCode;
  nodeId?: string;
  parentId?: string;
}

/** Detects a directed cycle in parent pointers (self-loop included). */
export function hasParentCycle(
  nodes: ReadonlyArray<{ id: string; parentId: string | null }>,
): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const start of nodes) {
    const seen = new Set<string>();
    let cur: string | null | undefined = start.id;
    for (let i = 0; i < nodes.length + 2; i += 1) {
      if (!cur) break;
      if (seen.has(cur)) return true;
      seen.add(cur);
      cur = byId.get(cur)?.parentId ?? null;
    }
  }
  return false;
}

/** True if `ancestorId` is on the path from `nodeId` upwards (inclusive). */
export function isAncestorOf(
  nodes: ReadonlyArray<{ id: string; parentId: string | null }>,
  ancestorId: string,
  nodeId: string,
): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  let cur: string | null | undefined = nodeId;
  while (cur && !seen.has(cur)) {
    if (cur === ancestorId) return true;
    seen.add(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}

export function sortSiblings(
  nodes: ReadonlyArray<VerticalTreeNodeShape>,
  parentKey: string | null,
): VerticalTreeNodeShape[] {
  return nodes
    .filter((n) => n.parentId === parentKey)
    .sort(
      (a, b) =>
        a.order - b.order ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
}

function normalizeOrdersForTree(nodes: VerticalTreeNodeShape[]): void {
  const byParent = new Map<string | null, VerticalTreeNodeShape[]>();
  for (const n of nodes) {
    const k = n.parentId;
    const b = byParent.get(k) ?? [];
    b.push(n);
    byParent.set(k, b);
  }
  for (const [, group] of byParent) {
    const sorted = [...group].sort(
      (a, b) =>
        a.order - b.order ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
    sorted.forEach((row, i) => {
      row.order = i + 1;
    });
  }
}

/** Reparent `draggedId` under `newParentId` (or root if null). */
export function reparentNode(
  nodes: readonly VerticalTreeNodeShape[],
  draggedId: string,
  newParentId: string | null,
): { nodes: VerticalTreeNodeShape[]; error: VerticalTreeValidationError | null } {
  const list = nodes.map((n) => ({ ...n }));
  const dragged = list.find((n) => n.id === draggedId);
  if (!dragged) return { nodes: list, error: { code: "id_mismatch" } };

  const prevParent = dragged.parentId;

  if (dragged.isLobby && newParentId !== prevParent) {
    return { nodes: list, error: { code: "lobby_reparent", nodeId: draggedId } };
  }

  if (newParentId === draggedId) {
    return { nodes: list, error: { code: "cycle", nodeId: draggedId } };
  }
  if (newParentId && isAncestorOf(list, draggedId, newParentId)) {
    return {
      nodes: list,
      error: { code: "cycle", nodeId: draggedId, parentId: newParentId },
    };
  }

  dragged.parentId = newParentId;
  normalizeOrdersForTree(list);

  return { nodes: list, error: null };
}

/** Reorder among siblings of `draggedId` relative to `targetId` (same parent). */
export function reorderSiblingRelative(
  nodes: readonly VerticalTreeNodeShape[],
  draggedId: string,
  targetId: string,
  placeAfter: boolean,
): { nodes: VerticalTreeNodeShape[]; error: VerticalTreeValidationError | null } {
  if (draggedId === targetId) {
    return { nodes: nodes.map((n) => ({ ...n })), error: null };
  }
  const list = nodes.map((n) => ({ ...n }));
  const dragged = list.find((n) => n.id === draggedId);
  const target = list.find((n) => n.id === targetId);
  if (!dragged || !target) return { nodes: list, error: { code: "id_mismatch" } };
  if (dragged.parentId !== target.parentId) {
    return { nodes: list, error: { code: "id_mismatch" } };
  }

  const parentKey = dragged.parentId;
  const ordered = sortSiblings(list, parentKey).filter((n) => n.id !== draggedId);
  const targetIdx = ordered.findIndex((n) => n.id === targetId);
  if (targetIdx < 0) return { nodes: list, error: { code: "id_mismatch" } };

  const insertAt = placeAfter ? targetIdx + 1 : targetIdx;
  ordered.splice(insertAt, 0, dragged);

  for (let i = 0; i < ordered.length; i += 1) {
    const slot = ordered[i];
    if (!slot) continue;
    const row = list.find((x) => x.id === slot.id);
    if (row) row.order = i + 1;
  }

  normalizeOrdersForTree(list);

  return { nodes: list, error: null };
}

/**
 * Validates a full proposed parent/order list against DB baseline (ids + lobby).
 */
export function validateProposedStructure(
  baseline: ReadonlyArray<VerticalTreeNodeShape>,
  proposed: ReadonlyArray<{ id: string; parentId: string | null; order: number }>,
): VerticalTreeValidationError | null {
  const baseById = new Map(baseline.map((n) => [n.id, n]));
  const ids = new Set(baseline.map((b) => b.id));
  if (proposed.length !== ids.size) {
    return { code: "id_mismatch" };
  }
  const propIds = new Set(proposed.map((p) => p.id));
  for (const id of ids) {
    if (!propIds.has(id)) return { code: "id_mismatch" };
  }
  for (const id of propIds) {
    if (!ids.has(id)) return { code: "id_mismatch" };
  }

  for (const row of proposed) {
    if (row.parentId !== null && !ids.has(row.parentId)) {
      return { code: "unknown_parent", parentId: row.parentId };
    }
  }

  const merged = proposed.map((p) => {
    const b = baseById.get(p.id);
    if (!b) return null;
    return {
      id: p.id,
      parentId: p.parentId,
      order: p.order,
      isLobby: b.isLobby,
      createdAt: b.createdAt,
    };
  });
  if (merged.some((m) => m === null)) return { code: "id_mismatch" };
  const asShapes = merged as VerticalTreeNodeShape[];

  if (hasParentCycle(asShapes.map((n) => ({ id: n.id, parentId: n.parentId })))) {
    return { code: "cycle" };
  }

  for (const b of baseline) {
    if (!b.isLobby) continue;
    const pr = proposed.find((p) => p.id === b.id);
    if (pr && pr.parentId !== b.parentId) {
      return { code: "lobby_reparent", nodeId: b.id };
    }
  }

  return null;
}

/** Topological order for applying parent updates (children after parents). */
export function sortForStructuralApply(
  proposed: ReadonlyArray<{ id: string; parentId: string | null }>,
): string[] {
  const ids = new Set(proposed.map((p) => p.id));
  const pending = new Set(ids);
  const result: string[] = [];
  while (pending.size > 0) {
    const batch: string[] = [];
    for (const id of pending) {
      const row = proposed.find((p) => p.id === id);
      if (!row) continue;
      const p = row.parentId;
      if (p === null || !pending.has(p)) {
        batch.push(id);
      }
    }
    if (batch.length === 0) {
      throw new Error("vertical-tree: cycle in proposed structure");
    }
    for (const id of batch) {
      pending.delete(id);
      result.push(id);
    }
  }
  return result;
}
