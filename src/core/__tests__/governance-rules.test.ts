/**
 * Unit tests for `src/core/governance-rules.ts`.
 *
 * Покрываем:
 *   * `DEFAULT_GOVERNANCE_RULES` (форма + значения);
 *   * `isGovernanceManageableKey`;
 *   * `resolveAllowedKeys` (пустой, "*" и точечный whitelist);
 *   * `normaliseGovernanceRules` (все ветки «если число — clamp, иначе default»);
 *   * `validateGovernanceRulesPatch` (строгий вариант, каждое поле).
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_GOVERNANCE_RULES,
  GOVERNANCE_MANAGEABLE_KEYS,
  GovernanceRulesError,
  isGovernanceManageableKey,
  normaliseGovernanceRules,
  resolveAllowedKeys,
  validateGovernanceRulesPatch,
} from "../governance-rules";

describe("DEFAULT_GOVERNANCE_RULES", () => {
  it("boots in 'decree' with empty whitelist and sovereign veto enabled", () => {
    expect(DEFAULT_GOVERNANCE_RULES.mode).toBe("decree");
    expect(DEFAULT_GOVERNANCE_RULES.sovereignVeto).toBe(true);
    expect(DEFAULT_GOVERNANCE_RULES.allowedConfigKeys).toEqual([]);
    expect(DEFAULT_GOVERNANCE_RULES.quorumBps).toBe(2_000);
    expect(DEFAULT_GOVERNANCE_RULES.thresholdBps).toBe(6_000);
    expect(DEFAULT_GOVERNANCE_RULES.votingDurationSeconds).toBe(259_200);
  });
});

describe("isGovernanceManageableKey", () => {
  it("accepts every canonical key and rejects unknowns", () => {
    for (const k of GOVERNANCE_MANAGEABLE_KEYS) {
      expect(isGovernanceManageableKey(k)).toBe(true);
    }
    expect(isGovernanceManageableKey("governanceRules")).toBe(false);
    expect(isGovernanceManageableKey("bogus")).toBe(false);
  });
});

describe("resolveAllowedKeys", () => {
  it("empty or missing list → empty set", () => {
    expect(
      resolveAllowedKeys({ ...DEFAULT_GOVERNANCE_RULES, allowedConfigKeys: [] }).size,
    ).toBe(0);
  });

  it("'*' expands to every manageable key", () => {
    const set = resolveAllowedKeys({
      ...DEFAULT_GOVERNANCE_RULES,
      allowedConfigKeys: ["*"],
    });
    expect(set.size).toBe(GOVERNANCE_MANAGEABLE_KEYS.length);
    for (const k of GOVERNANCE_MANAGEABLE_KEYS) {
      expect(set.has(k)).toBe(true);
    }
  });

  it("filters out unknown keys while keeping valid ones", () => {
    const set = resolveAllowedKeys({
      ...DEFAULT_GOVERNANCE_RULES,
      allowedConfigKeys: ["transactionTaxRate", "bogus", "incomeTaxRate"],
    });
    expect([...set].sort()).toEqual(
      ["incomeTaxRate", "transactionTaxRate"].sort(),
    );
  });
});

// ------------------------------------------------------------
// normaliseGovernanceRules — never throws
// ------------------------------------------------------------

describe("normaliseGovernanceRules", () => {
  it("returns a fresh default copy for non-objects", () => {
    const n = normaliseGovernanceRules(null);
    expect(n).toEqual(DEFAULT_GOVERNANCE_RULES);
    expect(normaliseGovernanceRules("hello")).toEqual(DEFAULT_GOVERNANCE_RULES);
    expect(normaliseGovernanceRules([1, 2])).toEqual(DEFAULT_GOVERNANCE_RULES);
  });

  it("applies valid fields and ignores invalid ones", () => {
    const out = normaliseGovernanceRules({
      mode: "consultation",
      sovereignVeto: false,
      quorumBps: 1_234,
      thresholdBps: 5_000,
      votingDurationSeconds: 3_600,
      weightStrategy: "by_balance",
      nodeWeights: { node_a: 3, bad_neg: -5, bad_type: "x" },
      balanceAssetId: "asset_gold",
      minProposerPermission: "governance.propose",
      minProposerBalance: 10,
      allowedConfigKeys: ["transactionTaxRate", "bogus", "  "],
    });
    expect(out.mode).toBe("consultation");
    expect(out.sovereignVeto).toBe(false);
    expect(out.quorumBps).toBe(1_234);
    expect(out.thresholdBps).toBe(5_000);
    expect(out.votingDurationSeconds).toBe(3_600);
    expect(out.weightStrategy).toBe("by_balance");
    expect(out.nodeWeights).toEqual({ node_a: 3 });
    expect(out.balanceAssetId).toBe("asset_gold");
    expect(out.minProposerPermission).toBe("governance.propose");
    expect(out.minProposerBalance).toBe(10);
    expect(out.allowedConfigKeys).toEqual(["transactionTaxRate"]);
  });

  it("silently drops out-of-range numbers", () => {
    const out = normaliseGovernanceRules({
      quorumBps: 99_999,
      thresholdBps: -1,
      votingDurationSeconds: 10, // below the 60s floor.
      minProposerBalance: -50,
    });
    expect(out.quorumBps).toBe(DEFAULT_GOVERNANCE_RULES.quorumBps);
    expect(out.thresholdBps).toBe(DEFAULT_GOVERNANCE_RULES.thresholdBps);
    expect(out.votingDurationSeconds).toBe(
      DEFAULT_GOVERNANCE_RULES.votingDurationSeconds,
    );
    expect(out.minProposerBalance).toBeNull();
  });

  it("accepts explicit nulls for nullable scalars", () => {
    const out = normaliseGovernanceRules({
      balanceAssetId: null,
      minProposerPermission: null,
      minProposerBalance: null,
    });
    expect(out.balanceAssetId).toBeNull();
    expect(out.minProposerPermission).toBeNull();
    expect(out.minProposerBalance).toBeNull();
  });

  it("rejects wrong-shape nodeWeights gracefully", () => {
    const out = normaliseGovernanceRules({ nodeWeights: [1, 2, 3] });
    expect(out.nodeWeights).toEqual(DEFAULT_GOVERNANCE_RULES.nodeWeights);
  });
});

// ------------------------------------------------------------
// validateGovernanceRulesPatch — strict; every field throws on abuse
// ------------------------------------------------------------

describe("validateGovernanceRulesPatch", () => {
  it("rejects non-object patches", () => {
    expect(() => validateGovernanceRulesPatch(null)).toThrow(
      GovernanceRulesError,
    );
    expect(() => validateGovernanceRulesPatch("nope")).toThrow(
      GovernanceRulesError,
    );
    expect(() => validateGovernanceRulesPatch([1])).toThrow(
      GovernanceRulesError,
    );
  });

  it("accepts a minimal valid patch and returns only provided keys", () => {
    const out = validateGovernanceRulesPatch({ mode: "auto_dao" });
    expect(out).toEqual({ mode: "auto_dao" });
  });

  it("throws on bad mode", () => {
    expect(() =>
      validateGovernanceRulesPatch({ mode: "monarchy" }),
    ).toThrow(/mode/);
  });

  it("coerces sovereignVeto into a boolean", () => {
    const out = validateGovernanceRulesPatch({ sovereignVeto: 1 });
    expect(out.sovereignVeto).toBe(true);
  });

  it("throws on out-of-range quorumBps / thresholdBps", () => {
    expect(() =>
      validateGovernanceRulesPatch({ quorumBps: -1 }),
    ).toThrow(/quorumBps/);
    expect(() =>
      validateGovernanceRulesPatch({ quorumBps: "50%" }),
    ).toThrow(/quorumBps/);
    expect(() =>
      validateGovernanceRulesPatch({ thresholdBps: 99_999 }),
    ).toThrow(/thresholdBps/);
  });

  it("throws on bad votingDurationSeconds", () => {
    expect(() =>
      validateGovernanceRulesPatch({ votingDurationSeconds: 1 }),
    ).toThrow(/votingDurationSeconds/);
    expect(() =>
      validateGovernanceRulesPatch({ votingDurationSeconds: "ten" }),
    ).toThrow(/votingDurationSeconds/);
  });

  it("throws on bad weightStrategy", () => {
    expect(() =>
      validateGovernanceRulesPatch({ weightStrategy: "random" }),
    ).toThrow(/weightStrategy/);
  });

  it("validates nodeWeights entries", () => {
    expect(() =>
      validateGovernanceRulesPatch({ nodeWeights: { a: 0 } }),
    ).toThrow(/nodeWeights/);
    expect(() =>
      validateGovernanceRulesPatch({ nodeWeights: [1] }),
    ).toThrow(/nodeWeights/);
    const ok = validateGovernanceRulesPatch({ nodeWeights: { a: 2, b: 4 } });
    expect(ok.nodeWeights).toEqual({ a: 2, b: 4 });
  });

  it("validates balanceAssetId shape", () => {
    expect(() =>
      validateGovernanceRulesPatch({ balanceAssetId: 42 }),
    ).toThrow(/balanceAssetId/);
    expect(
      validateGovernanceRulesPatch({ balanceAssetId: null }).balanceAssetId,
    ).toBeNull();
    expect(
      validateGovernanceRulesPatch({ balanceAssetId: "asset_x" })
        .balanceAssetId,
    ).toBe("asset_x");
  });

  it("validates minProposerPermission / minProposerBalance", () => {
    expect(() =>
      validateGovernanceRulesPatch({ minProposerPermission: 5 }),
    ).toThrow(/minProposerPermission/);
    expect(
      validateGovernanceRulesPatch({ minProposerPermission: null })
        .minProposerPermission,
    ).toBeNull();

    expect(() =>
      validateGovernanceRulesPatch({ minProposerBalance: -1 }),
    ).toThrow(/minProposerBalance/);
    expect(() =>
      validateGovernanceRulesPatch({ minProposerBalance: "lots" }),
    ).toThrow(/minProposerBalance/);
    expect(
      validateGovernanceRulesPatch({ minProposerBalance: null })
        .minProposerBalance,
    ).toBeNull();
    expect(
      validateGovernanceRulesPatch({ minProposerBalance: 7 })
        .minProposerBalance,
    ).toBe(7);
  });

  it("validates allowedConfigKeys (array of known strings)", () => {
    expect(() =>
      validateGovernanceRulesPatch({ allowedConfigKeys: "all" }),
    ).toThrow(/allowedConfigKeys/);
    expect(() =>
      validateGovernanceRulesPatch({ allowedConfigKeys: [5] as never }),
    ).toThrow(/allowedConfigKeys/);
    expect(() =>
      validateGovernanceRulesPatch({ allowedConfigKeys: ["bogus"] }),
    ).toThrow(/allowedConfigKeys/);

    const ok = validateGovernanceRulesPatch({
      allowedConfigKeys: ["*", "", "transactionTaxRate"],
    });
    expect(ok.allowedConfigKeys).toEqual(["*", "transactionTaxRate"]);
  });
});
