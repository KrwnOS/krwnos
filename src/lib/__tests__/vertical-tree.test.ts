import { describe, expect, it } from "vitest";
import {
  hasParentCycle,
  isAncestorOf,
  reparentNode,
  reorderSiblingRelative,
  sortForStructuralApply,
  validateProposedStructure,
  type VerticalTreeNodeShape,
} from "../vertical-tree";

const created = "2026-01-01T00:00:00.000Z";

function n(
  id: string,
  parentId: string | null,
  order: number,
  isLobby = false,
): VerticalTreeNodeShape {
  return { id, parentId, order, isLobby, createdAt: created };
}

describe("vertical-tree", () => {
  it("detects cycle", () => {
    expect(
      hasParentCycle([
        { id: "a", parentId: "b" },
        { id: "b", parentId: "c" },
        { id: "c", parentId: "a" },
      ]),
    ).toBe(true);
    expect(
      hasParentCycle([
        { id: "a", parentId: null },
        { id: "b", parentId: "a" },
      ]),
    ).toBe(false);
  });

  it("isAncestorOf", () => {
    const nodes = [
      { id: "r", parentId: null },
      { id: "a", parentId: "r" },
      { id: "b", parentId: "a" },
    ];
    expect(isAncestorOf(nodes, "a", "b")).toBe(true);
    expect(isAncestorOf(nodes, "b", "a")).toBe(false);
  });

  it("reparentNode rejects moving under descendant", () => {
    const nodes = [n("r", null, 1), n("a", "r", 1), n("b", "a", 1)];
    const { error } = reparentNode(nodes, "a", "b");
    expect(error?.code).toBe("cycle");
  });

  it("reparentNode moves under new parent", () => {
    const nodes = [
      n("r", null, 1),
      n("a", "r", 1),
      n("b", "r", 2),
    ];
    const { nodes: next, error } = reparentNode(nodes, "b", "a");
    expect(error).toBeNull();
    expect(next.find((x) => x.id === "b")?.parentId).toBe("a");
  });

  it("reparentNode blocks lobby reparent", () => {
    const nodes = [n("lob", null, 1, true), n("x", "lob", 1)];
    const { error } = reparentNode(nodes, "lob", "x");
    expect(error?.code).toBe("lobby_reparent");
  });

  it("reorderSiblingRelative", () => {
    const nodes = [
      n("r", null, 1),
      n("a", "r", 1),
      n("b", "r", 2),
      n("c", "r", 3),
    ];
    const { nodes: next, error } = reorderSiblingRelative(nodes, "c", "a", false);
    expect(error).toBeNull();
    const orders = next
      .filter((x) => x.parentId === "r")
      .sort((x, y) => x.order - y.order)
      .map((x) => x.id);
    expect(orders[0]).toBe("c");
    expect(orders[1]).toBe("a");
  });

  it("sortForStructuralApply orders roots before children", () => {
    const order = sortForStructuralApply([
      { id: "c", parentId: "b" },
      { id: "a", parentId: null },
      { id: "b", parentId: "a" },
    ]);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
  });

  it("validateProposedStructure catches lobby drift", () => {
    const baseline = [n("lob", null, 1, true), n("x", "lob", 1)];
    const err = validateProposedStructure(baseline, [
      { id: "lob", parentId: "x", order: 1 },
      { id: "x", parentId: null, order: 1 },
    ]);
    expect(err?.code).toBe("lobby_reparent");
  });
});
