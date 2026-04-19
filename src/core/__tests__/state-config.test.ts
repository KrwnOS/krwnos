/**
 * Unit tests for `StateConfigService` — Палата Указов.
 *
 * Сервис persistence-agnostic: всё живёт на in-memory fake.
 * Покрываем:
 *   * `get` лениво создаёт строку при её отсутствии;
 *   * `update` отклоняется без owner/`state.configure`;
 *   * Суверен и держатель `state.configure` могут писать;
 *   * валидация всех проверяемых полей;
 *   * шина событий `core.state.settings.updated` публикует diff;
 *   * `validatePatch` нормализует строки (trim, пустая → null).
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_STATE_SETTINGS,
  STATE_CONFIG_EVENTS,
  StateConfigError,
  StateConfigPermissions,
  StateConfigService,
  summariseSettings,
  validatePatch,
  type StateConfigAccessContext,
  type StateConfigRepository,
  type StateSettings,
  type UpdateStateSettingsPatch,
} from "../state-config";
import { DEFAULT_GOVERNANCE_RULES } from "../governance-rules";
import type { ModuleEventBus, PermissionKey } from "@/types/kernel";

// ------------------------------------------------------------
// In-memory fakes
// ------------------------------------------------------------

function makeBus(): ModuleEventBus & {
  events: Array<{ event: string; payload: unknown }>;
} {
  const events: Array<{ event: string; payload: unknown }> = [];
  return {
    events,
    async emit(event, payload) {
      events.push({ event, payload });
    },
    on() {
      return () => {};
    },
  } as ModuleEventBus & {
    events: Array<{ event: string; payload: unknown }>;
  };
}

function makeRepo(): StateConfigRepository & {
  rows: Map<string, StateSettings>;
} {
  const rows = new Map<string, StateSettings>();
  const hydrate = (stateId: string): StateSettings => {
    const now = new Date();
    return {
      id: `ss_${stateId}`,
      stateId,
      transactionTaxRate: 0,
      incomeTaxRate: 0,
      roleTaxRate: 0,
      currencyDisplayName: null,
      citizenshipFeeAmount: 0,
      rolesPurchasable: false,
      exitRefundRate: 0,
      permissionInheritance: true,
      autoPromotionEnabled: false,
      autoPromotionMinBalance: null,
      autoPromotionMinDays: null,
      autoPromotionTargetNodeId: null,
      treasuryTransparency: "council",
      governanceRules: { ...DEFAULT_GOVERNANCE_RULES },
      extras: {},
      createdAt: now,
      updatedAt: now,
    };
  };
  return {
    rows,
    async find(stateId) {
      return rows.get(stateId) ?? null;
    },
    async ensure(stateId) {
      const existing = rows.get(stateId);
      if (existing) return existing;
      const row = hydrate(stateId);
      rows.set(stateId, row);
      return row;
    },
    async update(stateId, patch) {
      const existing = rows.get(stateId) ?? hydrate(stateId);
      const next: StateSettings = {
        ...existing,
        ...patch,
        // JSON field deep-copied to avoid shared references in tests.
        extras: { ...(existing.extras ?? {}), ...(patch.extras ?? {}) },
        updatedAt: new Date(),
      } as StateSettings;
      rows.set(stateId, next);
      return next;
    },
  };
}

function sovereign(userId = "u_owner"): StateConfigAccessContext {
  return {
    userId,
    isOwner: true,
    permissions: new Set<PermissionKey>(),
  };
}

function peasant(userId = "u_peasant"): StateConfigAccessContext {
  return {
    userId,
    isOwner: false,
    permissions: new Set<PermissionKey>(),
  };
}

function parliament(userId = "u_parliament"): StateConfigAccessContext {
  return {
    userId,
    isOwner: false,
    permissions: new Set<PermissionKey>([StateConfigPermissions.Configure]),
  };
}

function wildcard(userId = "u_wild"): StateConfigAccessContext {
  return {
    userId,
    isOwner: false,
    permissions: new Set<PermissionKey>(["*"]),
  };
}

// ------------------------------------------------------------
// Specs
// ------------------------------------------------------------

describe("StateConfigService.get", () => {
  it("lazy-provisions the row with defaults on first read", async () => {
    const repo = makeRepo();
    const svc = new StateConfigService({ repo });

    expect(repo.rows.size).toBe(0);
    const settings = await svc.get("state_a");
    expect(repo.rows.size).toBe(1);
    expect(settings.stateId).toBe("state_a");
    expect(settings.transactionTaxRate).toBe(0);
    expect(settings.treasuryTransparency).toBe("council");
    expect(settings.permissionInheritance).toBe(true);
  });

  it("returns identical row on subsequent reads", async () => {
    const repo = makeRepo();
    const svc = new StateConfigService({ repo });
    const a = await svc.get("state_a");
    const b = await svc.get("state_a");
    expect(b.id).toBe(a.id);
    expect(repo.rows.size).toBe(1);
  });

  it("`getSummary` projects the hot-path subset", async () => {
    const repo = makeRepo();
    const svc = new StateConfigService({ repo });
    await svc.update("state_a", sovereign(), {
      transactionTaxRate: 0.05,
      incomeTaxRate: 0.1,
      roleTaxRate: 0.02,
      citizenshipFeeAmount: 100,
      permissionInheritance: false,
      treasuryTransparency: "sovereign",
    });
    const summary = await svc.getSummary("state_a");
    expect(summary).toEqual({
      stateId: "state_a",
      transactionTaxRate: 0.05,
      incomeTaxRate: 0.1,
      roleTaxRate: 0.02,
      citizenshipFeeAmount: 100,
      permissionInheritance: false,
      treasuryTransparency: "sovereign",
    });
  });
});

describe("StateConfigService.update — authorization", () => {
  it("allows the Sovereign", async () => {
    const repo = makeRepo();
    const svc = new StateConfigService({ repo });
    const res = await svc.update("state_a", sovereign(), {
      transactionTaxRate: 0.01,
    });
    expect(res.transactionTaxRate).toBe(0.01);
  });

  it("allows a holder of `state.configure`", async () => {
    const repo = makeRepo();
    const svc = new StateConfigService({ repo });
    const res = await svc.update("state_a", parliament(), {
      transactionTaxRate: 0.02,
    });
    expect(res.transactionTaxRate).toBe(0.02);
  });

  it("allows a wildcard-permission holder", async () => {
    const repo = makeRepo();
    const svc = new StateConfigService({ repo });
    const res = await svc.update("state_a", wildcard(), {
      transactionTaxRate: 0.03,
    });
    expect(res.transactionTaxRate).toBe(0.03);
  });

  it("rejects an ordinary citizen", async () => {
    const repo = makeRepo();
    const svc = new StateConfigService({ repo });
    await expect(
      svc.update("state_a", peasant(), { transactionTaxRate: 0.01 }),
    ).rejects.toMatchObject({
      name: "StateConfigError",
      code: "forbidden",
    });
  });
});

describe("StateConfigService.update — validation", () => {
  const svc = () => new StateConfigService({ repo: makeRepo() });

  it("clamps rate to [0..1]", async () => {
    await expect(
      svc().update("state_a", sovereign(), { transactionTaxRate: 1.5 }),
    ).rejects.toBeInstanceOf(StateConfigError);
    await expect(
      svc().update("state_a", sovereign(), { incomeTaxRate: -0.1 }),
    ).rejects.toBeInstanceOf(StateConfigError);
  });

  it("rejects non-finite numbers", async () => {
    await expect(
      svc().update("state_a", sovereign(), {
        transactionTaxRate: Number.POSITIVE_INFINITY,
      }),
    ).rejects.toBeInstanceOf(StateConfigError);
    await expect(
      svc().update("state_a", sovereign(), { citizenshipFeeAmount: NaN }),
    ).rejects.toBeInstanceOf(StateConfigError);
  });

  it("rejects negative citizenshipFeeAmount", async () => {
    await expect(
      svc().update("state_a", sovereign(), { citizenshipFeeAmount: -1 }),
    ).rejects.toBeInstanceOf(StateConfigError);
  });

  it("accepts `null` for nullable fields", async () => {
    const res = await svc().update("state_a", sovereign(), {
      currencyDisplayName: null,
      autoPromotionMinBalance: null,
      autoPromotionMinDays: null,
      autoPromotionTargetNodeId: null,
    });
    expect(res.currencyDisplayName).toBeNull();
    expect(res.autoPromotionMinBalance).toBeNull();
    expect(res.autoPromotionMinDays).toBeNull();
    expect(res.autoPromotionTargetNodeId).toBeNull();
  });

  it("rejects unknown treasuryTransparency", async () => {
    await expect(
      svc().update("state_a", sovereign(), {
        treasuryTransparency: "moon" as unknown as "public",
      }),
    ).rejects.toBeInstanceOf(StateConfigError);
  });

  it("rejects non-integer / out-of-range autoPromotionMinDays", async () => {
    await expect(
      svc().update("state_a", sovereign(), { autoPromotionMinDays: 3.14 }),
    ).rejects.toBeInstanceOf(StateConfigError);
    await expect(
      svc().update("state_a", sovereign(), { autoPromotionMinDays: -1 }),
    ).rejects.toBeInstanceOf(StateConfigError);
    await expect(
      svc().update("state_a", sovereign(), { autoPromotionMinDays: 100_000 }),
    ).rejects.toBeInstanceOf(StateConfigError);
  });

  it("rejects arrays / null in `extras`", async () => {
    await expect(
      svc().update("state_a", sovereign(), {
        extras: [1, 2, 3] as unknown as Record<string, unknown>,
      }),
    ).rejects.toBeInstanceOf(StateConfigError);
    await expect(
      svc().update("state_a", sovereign(), {
        extras: null as unknown as Record<string, unknown>,
      }),
    ).rejects.toBeInstanceOf(StateConfigError);
  });
});

describe("validatePatch (pure)", () => {
  it("trims currencyDisplayName and collapses whitespace-only to null", () => {
    expect(
      validatePatch({ currencyDisplayName: "  Royal Krona  " })
        .currencyDisplayName,
    ).toBe("Royal Krona");
    expect(
      validatePatch({ currencyDisplayName: "   " }).currencyDisplayName,
    ).toBeNull();
  });

  it("rejects currencyDisplayName longer than 64 chars", () => {
    expect(() =>
      validatePatch({ currencyDisplayName: "x".repeat(65) }),
    ).toThrow(StateConfigError);
  });

  it("coerces boolean flags", () => {
    const res = validatePatch({
      rolesPurchasable: 1 as unknown as boolean,
      permissionInheritance: 0 as unknown as boolean,
      autoPromotionEnabled: "yes" as unknown as boolean,
    });
    expect(res.rolesPurchasable).toBe(true);
    expect(res.permissionInheritance).toBe(false);
    expect(res.autoPromotionEnabled).toBe(true);
  });

  it("omits undefined fields from output (pure whitelist)", () => {
    const res = validatePatch({ transactionTaxRate: 0.1 });
    expect(res).toEqual({ transactionTaxRate: 0.1 });
    expect(Object.keys(res)).toEqual(["transactionTaxRate"]);
  });
});

describe("StateConfigService event bus", () => {
  it("emits `settings.updated` with before/after summaries", async () => {
    const repo = makeRepo();
    const bus = makeBus();
    const svc = new StateConfigService({ repo, bus });

    await svc.update("state_a", sovereign(), { transactionTaxRate: 0.05 });

    // micro-task flush: StateConfigService emits inside the same
    // promise chain, but we await `update()` so it has settled.
    expect(bus.events).toHaveLength(1);
    const ev = bus.events[0]!;
    expect(ev.event).toBe(STATE_CONFIG_EVENTS.Updated);
    const payload = ev.payload as {
      stateId: string;
      before: { transactionTaxRate: number };
      after: { transactionTaxRate: number };
      updatedById: string;
    };
    expect(payload.stateId).toBe("state_a");
    expect(payload.before.transactionTaxRate).toBe(0);
    expect(payload.after.transactionTaxRate).toBe(0.05);
    expect(payload.updatedById).toBe("u_owner");
  });

  it("omits event when no bus is configured", async () => {
    const repo = makeRepo();
    const svc = new StateConfigService({ repo });
    await expect(
      svc.update("state_a", sovereign(), { transactionTaxRate: 0.05 }),
    ).resolves.toBeDefined();
  });
});

describe("summariseSettings", () => {
  it("projects the expected subset and nothing else", async () => {
    const repo = makeRepo();
    const svc = new StateConfigService({ repo });
    const full = await svc.get("state_a");
    const summary = summariseSettings(full);
    expect(Object.keys(summary).sort()).toEqual(
      [
        "stateId",
        "transactionTaxRate",
        "incomeTaxRate",
        "roleTaxRate",
        "citizenshipFeeAmount",
        "permissionInheritance",
        "treasuryTransparency",
      ].sort(),
    );
  });
});

describe("ensureDefaults", () => {
  it("is idempotent and non-destructive", async () => {
    const repo = makeRepo();
    const svc = new StateConfigService({ repo });

    const first = await svc.ensureDefaults("state_a");
    // Mutate via legitimate path.
    await svc.update("state_a", sovereign(), { transactionTaxRate: 0.5 });

    const second = await svc.ensureDefaults("state_a");
    expect(second.id).toBe(first.id);
    expect(second.transactionTaxRate).toBe(0.5);
  });
});

describe("DEFAULT_STATE_SETTINGS", () => {
  it("matches the repository's hydrate defaults", async () => {
    const repo = makeRepo();
    const svc = new StateConfigService({ repo });
    const actual = await svc.get("state_a");
    // Every key declared in DEFAULT_STATE_SETTINGS must appear on
    // the hydrated row with a matching default — otherwise setup and
    // migrations drift over time.
    for (const [key, expected] of Object.entries(
      DEFAULT_STATE_SETTINGS as Record<string, unknown>,
    )) {
      expect((actual as unknown as Record<string, unknown>)[key]).toEqual(
        expected,
      );
    }
  });
});

// Satisfy the `UpdateStateSettingsPatch` import — type-only utility.
const _keepPatchType: UpdateStateSettingsPatch = {};
void _keepPatchType;
