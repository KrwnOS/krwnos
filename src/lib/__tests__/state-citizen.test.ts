import { describe, expect, it } from "vitest";
import { splitEmigrationAmounts } from "../state-citizen";

describe("splitEmigrationAmounts", () => {
  it("returns zeros for zero balance", () => {
    expect(splitEmigrationAmounts(0, 0.5, 18)).toEqual({ kept: 0, forfeit: 0 });
  });

  it("keeps full balance when exitRefundRate is 1", () => {
    expect(splitEmigrationAmounts(100, 1, 18)).toEqual({ kept: 100, forfeit: 0 });
  });

  it("forfeits full balance when exitRefundRate is 0", () => {
    expect(splitEmigrationAmounts(100, 0, 18)).toEqual({ kept: 0, forfeit: 100 });
  });

  it("splits 50/50 for rate 0.5", () => {
    const r = splitEmigrationAmounts(100, 0.5, 18);
    expect(r.kept + r.forfeit).toBeCloseTo(100, 5);
    expect(r.kept).toBeCloseTo(50, 5);
    expect(r.forfeit).toBeCloseTo(50, 5);
  });

  it("rejects invalid rate", () => {
    expect(() => splitEmigrationAmounts(10, 1.1, 18)).toThrow(RangeError);
  });
});
