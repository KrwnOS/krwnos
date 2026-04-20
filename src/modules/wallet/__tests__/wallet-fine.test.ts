import { describe, expect, it } from "vitest";
import {
  parseWalletFinePayload,
} from "../wallet-fine";
import {
  periodKeyForSubscription,
  utcMondayWeekPeriodKey,
} from "../node-subscription-tick";

describe("parseWalletFinePayload", () => {
  it("accepts a valid object", () => {
    const p = parseWalletFinePayload({
      debtorUserId: "u1",
      beneficiaryNodeId: "n1",
      amount: 10,
    });
    expect(p).toEqual({
      debtorUserId: "u1",
      beneficiaryNodeId: "n1",
      amount: 10,
    });
  });

  it("throws on invalid amount", () => {
    expect(() =>
      parseWalletFinePayload({
        debtorUserId: "u1",
        beneficiaryNodeId: "n1",
        amount: -1,
      }),
    ).toThrow();
  });
});

describe("node subscription period keys", () => {
  it("uses YYYY-MM for MONTHLY", () => {
    const d = new Date("2026-03-15T12:00:00Z");
    expect(periodKeyForSubscription("MONTHLY", d)).toBe("2026-03");
  });

  it("uses Monday UTC week for WEEKLY", () => {
    const d = new Date("2026-03-18T12:00:00Z"); // Wednesday
    expect(utcMondayWeekPeriodKey(d)).toBe("2026-03-16");
    expect(periodKeyForSubscription("WEEKLY", d)).toBe("2026-03-16");
  });
});
