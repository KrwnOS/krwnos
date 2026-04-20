/**
 * ICU MessageFormat snapshots — plural categories per locale.
 */

import { describe, expect, it } from "vitest";

import { formatIcu } from "../icu";

describe("ICU plural snapshots", () => {
  const enNodes =
    "{count, plural, one {# node} other {# nodes}}";

  it("English one vs other", () => {
    expect(formatIcu("en", enNodes, { count: 1 })).toMatchInlineSnapshot(
      `"1 node"`,
    );
    expect(formatIcu("en", enNodes, { count: 2 })).toMatchInlineSnapshot(
      `"2 nodes"`,
    );
    expect(formatIcu("en", enNodes, { count: 0 })).toMatchInlineSnapshot(
      `"0 nodes"`,
    );
  });

  const ruNodes =
    "{count, plural, one {# узел} few {# узла} many {# узлов} other {# узлов}}";

  it("Russian one / few / many", () => {
    expect(formatIcu("ru", ruNodes, { count: 1 })).toMatchInlineSnapshot(
      `"1 узел"`,
    );
    expect(formatIcu("ru", ruNodes, { count: 2 })).toMatchInlineSnapshot(
      `"2 узла"`,
    );
    expect(formatIcu("ru", ruNodes, { count: 5 })).toMatchInlineSnapshot(
      `"5 узлов"`,
    );
    expect(formatIcu("ru", ruNodes, { count: 21 })).toMatchInlineSnapshot(
      `"21 узел"`,
    );
  });

  const esNodes =
    "{count, plural, one {# nodo} other {# nodos}}";

  it("Spanish", () => {
    expect(formatIcu("es", esNodes, { count: 1 })).toMatchInlineSnapshot(
      `"1 nodo"`,
    );
    expect(formatIcu("es", esNodes, { count: 3 })).toMatchInlineSnapshot(
      `"3 nodos"`,
    );
  });

  const zhNodes = "{count, plural, other {# 个节点}}";

  it("Chinese uses other", () => {
    expect(formatIcu("zh", zhNodes, { count: 1 })).toMatchInlineSnapshot(
      `"1 个节点"`,
    );
    expect(formatIcu("zh", zhNodes, { count: 42 })).toMatchInlineSnapshot(
      `"42 个节点"`,
    );
  });

  const trNodes =
    "{count, plural, one {# düğüm} other {# düğüm}}";

  it("Turkish", () => {
    expect(formatIcu("tr", trNodes, { count: 1 })).toMatchInlineSnapshot(
      `"1 düğüm"`,
    );
    expect(formatIcu("tr", trNodes, { count: 8 })).toMatchInlineSnapshot(
      `"8 düğüm"`,
    );
  });
});
