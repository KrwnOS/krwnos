/**
 * Unit tests for `src/core/registry.ts`.
 *
 * Covered:
 *   * `ModuleRegistry.register` — init(), duplicate guards, cross-owner
 *     permission rejection, duplicate-key rejection.
 *   * `get` / `list` / `listForState` / `allPermissions`
 *     / `describePermission`.
 *   * `registerCorePermission` — idempotency + owner guard.
 *   * Singleton `registry` and `registerCorePermissions()` wiring the
 *     Exchange + state-config permissions into the singleton.
 *   * `exchangeService()` — lazy singleton + dep-override escape hatch.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Stub Prisma *before* registry imports it — registry's `exchangeService`
// helper calls `createPrismaExchangeRepository(prisma)` as a fallback.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("../exchange-prisma", () => ({
  createPrismaExchangeRepository: () => ({
    async findPair() {
      return null;
    },
    async upsertPair() {
      return { id: "fake" };
    },
    async listPairs() {
      return [];
    },
    async setPairEnabled() {
      /* noop */
    },
    async findAssetById() {
      return null;
    },
    async findWalletById() {
      return null;
    },
    async findWalletByOwner() {
      return null;
    },
    async mintTo() {
      /* noop */
    },
    async burnFrom() {
      /* noop */
    },
    async recordCrossStateTransaction() {
      return { id: "x" };
    },
  }),
}));

import { registerCorePermissions, registry } from "../registry";
import {
  ModuleRegistry,
  exchangeService,
} from "../registry";
import {
  exchangePermissionDescriptors,
} from "../exchange";
import { stateConfigPermissionDescriptors } from "../state-config";
import { membershipAdminPermissionDescriptors } from "../membership-admin-permissions";
import { credentialsPermissionDescriptors } from "../credentials-permissions";
import { moduleTrustPermissionDescriptors } from "../module-trust-permissions";
import { ExchangeService } from "../exchange";
import type {
  KrwnModule,
  PermissionDescriptor,
  PermissionKey,
} from "@/types/kernel";

function perm(
  key: string,
  owner: string,
  description = `desc: ${key}`,
): PermissionDescriptor {
  return {
    key: key as PermissionKey,
    owner,
    label: key,
    description,
  };
}

function module_(
  slug: string,
  permissions: PermissionDescriptor[],
  opts: { async?: boolean } = {},
): KrwnModule {
  const init = () => {
    if (opts.async) return Promise.resolve({ permissions });
    return { permissions };
  };
  return {
    slug,
    name: slug,
    version: "1.0.0",
    description: `module ${slug}`,
    init,
    getWidget: () => null,
    getSettings: () => null,
  };
}

describe("ModuleRegistry.register", () => {
  let reg: ModuleRegistry;
  beforeEach(() => {
    reg = new ModuleRegistry();
  });

  it("registers a module and exposes its permissions", async () => {
    const mod = module_("alpha", [perm("alpha.read", "alpha")]);
    await reg.register(mod);

    expect(reg.get("alpha")?.slug).toBe("alpha");
    expect(reg.list()).toHaveLength(1);
    expect(reg.allPermissions()).toHaveLength(1);
    expect(reg.describePermission("alpha.read" as PermissionKey)?.owner).toBe(
      "alpha",
    );
  });

  it("supports async init() resolving to the permission set", async () => {
    const mod = module_("beta", [perm("beta.x", "beta")], { async: true });
    await reg.register(mod);
    expect(reg.describePermission("beta.x" as PermissionKey)).toBeDefined();
  });

  it("rejects duplicate slug registration", async () => {
    const a = module_("dup", []);
    const b = module_("dup", []);
    await reg.register(a);
    await expect(reg.register(b)).rejects.toThrow(/already registered/i);
  });

  it("rejects permissions owned by a different module", async () => {
    const bad = module_("alpha", [perm("other.read", "other")]);
    await expect(reg.register(bad)).rejects.toThrow(
      /owned by "other"/,
    );
  });

  it("accepts permissions owned by 'core'", async () => {
    const mod = module_("alpha", [perm("core.shared", "core")]);
    await reg.register(mod);
    expect(
      reg.describePermission("core.shared" as PermissionKey)?.owner,
    ).toBe("core");
  });

  it("rejects a permission key already declared by another module", async () => {
    await reg.register(module_("alpha", [perm("shared.key", "alpha")]));
    await expect(
      reg.register(module_("beta", [perm("shared.key", "beta")])),
    ).rejects.toThrow(/already declared/);
  });
});

describe("ModuleRegistry.list / listForState", () => {
  it("listForState returns only modules present in the slug list", async () => {
    const reg = new ModuleRegistry();
    await reg.register(module_("alpha", []));
    await reg.register(module_("beta", []));
    await reg.register(module_("gamma", []));

    const picked = reg.listForState(["beta", "missing", "alpha"]);
    expect(picked.map((m) => m.slug)).toEqual(["beta", "alpha"]);
  });

  it("list() returns every registered module", async () => {
    const reg = new ModuleRegistry();
    await reg.register(module_("alpha", []));
    await reg.register(module_("beta", []));
    expect(reg.list().map((m) => m.slug).sort()).toEqual(["alpha", "beta"]);
  });

  it("get() is undefined for unknown slug", () => {
    const reg = new ModuleRegistry();
    expect(reg.get("nope")).toBeUndefined();
  });
});

describe("ModuleRegistry.registerCorePermission", () => {
  let reg: ModuleRegistry;
  beforeEach(() => {
    reg = new ModuleRegistry();
  });

  it("registers a core-owned descriptor", () => {
    const p = perm("core.foo", "core");
    reg.registerCorePermission(p);
    expect(reg.describePermission("core.foo" as PermissionKey)).toBe(p);
  });

  it("is idempotent on the same key (no throw)", () => {
    reg.registerCorePermission(perm("core.foo", "core"));
    expect(() =>
      reg.registerCorePermission(perm("core.foo", "core", "replacement")),
    ).not.toThrow();
    // First-writer-wins — later calls become no-ops.
    expect(
      reg.describePermission("core.foo" as PermissionKey)?.description,
    ).toBe("desc: core.foo");
  });

  it("refuses to register a non-core descriptor", () => {
    expect(() =>
      reg.registerCorePermission(perm("x.y", "some-mod")),
    ).toThrow(/must be "core"/);
  });
});

describe("registry + registerCorePermissions", () => {
  it("the default singleton is a ModuleRegistry", () => {
    expect(registry).toBeInstanceOf(ModuleRegistry);
  });

  it("registerCorePermissions installs exchange + state-config + members.* + credentials.* + modules.trust.* keys idempotently", () => {
    registerCorePermissions();
    // Second call must not throw — registerCorePermission is a no-op on dup.
    expect(() => registerCorePermissions()).not.toThrow();

    for (const p of exchangePermissionDescriptors) {
      expect(registry.describePermission(p.key)).toBe(p);
    }
    for (const p of stateConfigPermissionDescriptors) {
      expect(registry.describePermission(p.key)).toBe(p);
    }
    for (const p of membershipAdminPermissionDescriptors) {
      expect(registry.describePermission(p.key)).toBe(p);
    }
    for (const p of credentialsPermissionDescriptors) {
      expect(registry.describePermission(p.key)).toBe(p);
    }
    for (const p of moduleTrustPermissionDescriptors) {
      expect(registry.describePermission(p.key)).toBe(p);
    }
  });
});

describe("exchangeService()", () => {
  it("returns a shared ExchangeService when called without deps", () => {
    const a = exchangeService();
    const b = exchangeService();
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(ExchangeService);
  });

  it("returns a fresh instance when deps are supplied (escape hatch)", () => {
    const cached = exchangeService();
    const fake = {
      async findPair() {
        return null;
      },
      async upsertPair() {
        return { id: "f" };
      },
      async listPairs() {
        return [];
      },
      async setPairEnabled() {
        /* noop */
      },
      async findAssetById() {
        return null;
      },
      async findWalletById() {
        return null;
      },
      async findWalletByOwner() {
        return null;
      },
      async mintTo() {
        /* noop */
      },
      async burnFrom() {
        /* noop */
      },
      async recordCrossStateTransaction() {
        return { id: "x" };
      },
    };
    const overridden = exchangeService({ repo: fake as never });
    expect(overridden).not.toBe(cached);
    expect(overridden).toBeInstanceOf(ExchangeService);
  });
});
