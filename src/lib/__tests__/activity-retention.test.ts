import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getActivityLogRetentionCutoff,
  getActivityLogRetentionDaysFromEnv,
} from "../activity-retention";

describe("activity-retention", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to 365 days when env is unset", () => {
    vi.stubEnv("KRWN_ACTIVITY_LOG_RETENTION_DAYS", "");
    expect(getActivityLogRetentionDaysFromEnv()).toBe(365);
  });

  it("treats 0 as unlimited", () => {
    vi.stubEnv("KRWN_ACTIVITY_LOG_RETENTION_DAYS", "0");
    expect(getActivityLogRetentionDaysFromEnv()).toBeNull();
    expect(getActivityLogRetentionCutoff(new Date("2026-06-15T12:00:00Z"))).toBeNull();
  });

  it("computes cutoff as now minus N days", () => {
    vi.stubEnv("KRWN_ACTIVITY_LOG_RETENTION_DAYS", "10");
    expect(getActivityLogRetentionDaysFromEnv()).toBe(10);
    const now = new Date("2026-06-15T12:00:00.000Z");
    const cutoff = getActivityLogRetentionCutoff(now);
    expect(cutoff).not.toBeNull();
    expect(cutoff!.toISOString()).toBe("2026-06-05T12:00:00.000Z");
  });
});
