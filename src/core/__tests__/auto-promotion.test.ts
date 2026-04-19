import { describe, expect, it } from "vitest";
import { Decimal } from "@prisma/client/runtime/library";
import {
  fullDaysBetween,
  shouldPromoteMembershipForAutoPromotion,
} from "../auto-promotion";

describe("fullDaysBetween", () => {
  it("counts whole days", () => {
    const a = new Date("2026-01-01T12:00:00.000Z");
    const b = new Date("2026-01-11T11:59:59.999Z");
    expect(fullDaysBetween(a, b)).toBe(9);
  });

  it("is zero within the same calendar day span under 24h", () => {
    const a = new Date("2026-01-01T00:00:00.000Z");
    const b = new Date("2026-01-01T23:00:00.000Z");
    expect(fullDaysBetween(a, b)).toBe(0);
  });
});

describe("shouldPromoteMembershipForAutoPromotion", () => {
  const now = new Date("2026-06-15T00:00:00.000Z");

  it("returns false when both thresholds are null", () => {
    expect(
      shouldPromoteMembershipForAutoPromotion({
        minBalance: null,
        minDays: null,
        primaryBalance: new Decimal(1_000_000),
        membershipCreatedAt: new Date("2020-01-01T00:00:00.000Z"),
        now,
      }),
    ).toBe(false);
  });

  it("requires balance when minBalance is set", () => {
    expect(
      shouldPromoteMembershipForAutoPromotion({
        minBalance: 100,
        minDays: null,
        primaryBalance: new Decimal(99.99),
        membershipCreatedAt: new Date("2026-06-01T00:00:00.000Z"),
        now,
      }),
    ).toBe(false);
    expect(
      shouldPromoteMembershipForAutoPromotion({
        minBalance: 100,
        minDays: null,
        primaryBalance: new Decimal(100),
        membershipCreatedAt: new Date("2026-06-01T00:00:00.000Z"),
        now,
      }),
    ).toBe(true);
  });

  it("requires tenure when minDays is set", () => {
    const created = new Date("2026-06-10T00:00:00.000Z");
    expect(
      shouldPromoteMembershipForAutoPromotion({
        minBalance: null,
        minDays: 10,
        primaryBalance: new Decimal(0),
        membershipCreatedAt: created,
        now: new Date("2026-06-19T23:59:59.999Z"),
      }),
    ).toBe(false);
    expect(
      shouldPromoteMembershipForAutoPromotion({
        minBalance: null,
        minDays: 10,
        primaryBalance: new Decimal(0),
        membershipCreatedAt: created,
        now: new Date("2026-06-20T00:00:00.000Z"),
      }),
    ).toBe(true);
  });

  it("when both are set, either threshold is enough (OR)", () => {
    expect(
      shouldPromoteMembershipForAutoPromotion({
        minBalance: 50,
        minDays: 5,
        primaryBalance: new Decimal(100),
        membershipCreatedAt: new Date("2026-06-14T00:00:00.000Z"),
        now,
      }),
    ).toBe(true);
    expect(
      shouldPromoteMembershipForAutoPromotion({
        minBalance: 50,
        minDays: 5,
        primaryBalance: new Decimal(49),
        membershipCreatedAt: new Date("2026-06-01T00:00:00.000Z"),
        now,
      }),
    ).toBe(true);
    expect(
      shouldPromoteMembershipForAutoPromotion({
        minBalance: 50,
        minDays: 5,
        primaryBalance: new Decimal(10),
        membershipCreatedAt: new Date("2026-06-14T00:00:00.000Z"),
        now,
      }),
    ).toBe(false);
  });
});
