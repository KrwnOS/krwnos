import { describe, expect, it } from "vitest";
import type { ActivityLog, ActivityViewerContext } from "@/core/activity-feed";
import {
  filterVisibleActivity,
  pickDigestSubscription,
  toDigestPulseLines,
} from "../email-digest-aggregate";

function viewer(p: Partial<ActivityViewerContext> & Pick<ActivityViewerContext, "userId" | "stateId">): ActivityViewerContext {
  return {
    userId: p.userId,
    stateId: p.stateId,
    isOwner: p.isOwner ?? false,
    scopeNodeIds: p.scopeNodeIds ?? new Set(),
  };
}

describe("pickDigestSubscription", () => {
  it("respects daily vs weekly flags", () => {
    const row = { emailDigestDaily: true, emailDigestWeekly: false };
    expect(pickDigestSubscription("daily", row)).toBe(true);
    expect(pickDigestSubscription("weekly", row)).toBe(false);
  });
});

describe("filterVisibleActivity", () => {
  const base = (v: Partial<ActivityLog>): ActivityLog => ({
    id: "1",
    stateId: "st1",
    event: "e",
    category: "wallet",
    titleKey: "k",
    titleParams: {},
    actorId: null,
    nodeId: null,
    visibility: "public",
    audienceUserIds: [],
    metadata: {},
    createdAt: new Date(),
    ...v,
  });

  it("shows public rows to any citizen", () => {
    const rows = [base({ visibility: "public" })];
    const out = filterVisibleActivity(rows, viewer({ userId: "u1", stateId: "st1" }));
    expect(out).toHaveLength(1);
  });

  it("hides sovereign-only rows from non-owners", () => {
    const rows = [base({ visibility: "sovereign" })];
    const out = filterVisibleActivity(rows, viewer({ userId: "u1", stateId: "st1" }));
    expect(out).toHaveLength(0);
  });

  it("shows sovereign rows to owner", () => {
    const rows = [base({ visibility: "sovereign" })];
    const out = filterVisibleActivity(
      rows,
      viewer({ userId: "u1", stateId: "st1", isOwner: true }),
    );
    expect(out).toHaveLength(1);
  });
});

describe("toDigestPulseLines", () => {
  it("maps ActivityLog to digest lines", () => {
    const d = new Date("2026-04-20T00:00:00.000Z");
    const lines = toDigestPulseLines([
      {
        id: "1",
        stateId: "st",
        event: "x",
        category: "governance",
        titleKey: "pulse.x",
        titleParams: {},
        actorId: null,
        nodeId: null,
        visibility: "public",
        audienceUserIds: [],
        metadata: {},
        createdAt: d,
      },
    ]);
    expect(lines[0]).toEqual({
      stateId: "st",
      category: "governance",
      titleKey: "pulse.x",
      createdAt: d,
    });
  });
});
