import { describe, expect, it } from "vitest";
import { utcPeriodKeyForDate } from "../role-tax-tick";

describe("role-tax-tick", () => {
  it("utcPeriodKeyForDate uses YYYY-MM in UTC", () => {
    expect(utcPeriodKeyForDate(new Date("2026-04-19T12:00:00Z"))).toBe(
      "2026-04",
    );
    expect(utcPeriodKeyForDate(new Date("2026-01-01T00:00:00Z"))).toBe(
      "2026-01",
    );
  });
});
