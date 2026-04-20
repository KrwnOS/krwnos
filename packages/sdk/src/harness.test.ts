import { describe, expect, it } from "vitest";
import type { KrwnModule, PermissionDescriptor, PermissionKey } from "./module-contract.js";
import { createTestModuleContext, runModuleHarness } from "./harness.js";

function perm(key: string, owner: string): PermissionDescriptor {
  return { key: key as PermissionKey, owner, label: key };
}

const dummyModule: KrwnModule = {
  slug: "test.dummy",
  name: "Dummy",
  version: "0.0.0",
  init() {
    return { permissions: [perm("test.dummy.read", "test.dummy")] };
  },
  getWidget(ctx) {
    if (ctx.stateId === "no-widget") return null;
    return { id: "w1", title: "T", component: null };
  },
  getSettings: () => ({ title: "S", component: null }),
};

describe("createTestModuleContext", () => {
  it("fills defaults", () => {
    const ctx = createTestModuleContext();
    expect(ctx.stateId).toBe("state_test");
    expect(ctx.userId).toBe("user_test");
    expect(ctx.permissions.has("*" as PermissionKey)).toBe(true);
  });

  it("merges overrides", () => {
    const perms = ["a.b"] as PermissionKey[];
    const ctx = createTestModuleContext({
      stateId: "st_1",
      userId: null,
      permissions: perms,
    });
    expect(ctx.stateId).toBe("st_1");
    expect(ctx.userId).toBeNull();
    expect(ctx.permissions.has("a.b" as PermissionKey)).toBe(true);
  });
});

describe("runModuleHarness", () => {
  it("runs init and surface methods", async () => {
    const out = await runModuleHarness(dummyModule);
    expect(out.initResult.permissions).toHaveLength(1);
    expect(out.widget).toMatchObject({ id: "w1" });
    expect(out.settings).toMatchObject({ title: "S" });
  });

  it("passes context into getWidget", async () => {
    const out = await runModuleHarness(dummyModule, { stateId: "no-widget" });
    expect(out.widget).toBeNull();
  });
});
