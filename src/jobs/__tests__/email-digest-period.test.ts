import { describe, expect, it } from "vitest";
import {
  calendarDateKeyInTimeZone,
  digestPeriodKey,
  digestTimeWindow,
  getISOWeekYearAndWeekUTC,
  startOfUTCISOWeek,
  utcIsoWeekPeriodKey,
} from "../email-digest-period";

describe("digestTimeWindow", () => {
  it("uses 24h for daily and 7d for weekly", () => {
    const end = new Date("2026-04-20T12:00:00.000Z");
    const d = digestTimeWindow("daily", end);
    expect(d.end.getTime() - d.start.getTime()).toBe(86_400_000);
    const w = digestTimeWindow("weekly", end);
    expect(w.end.getTime() - w.start.getTime()).toBe(7 * 86_400_000);
  });
});

describe("calendarDateKeyInTimeZone", () => {
  it("formats civil date in IANA zone", () => {
    const d = new Date("2026-04-20T23:00:00.000Z");
    expect(calendarDateKeyInTimeZone(d, "UTC")).toBe("2026-04-20");
  });
});

describe("ISO week UTC helpers", () => {
  it("matches known ISO week for 2026-04-20 (W17)", () => {
    const d = new Date(Date.UTC(2026, 3, 20, 12, 0, 0));
    expect(utcIsoWeekPeriodKey(d)).toBe("2026-W17");
    const { weekYear, week } = getISOWeekYearAndWeekUTC(d);
    expect(weekYear).toBe(2026);
    expect(week).toBe(17);
  });

  it("startOfUTCISOWeek returns Monday 00:00 UTC", () => {
    const wed = new Date(Date.UTC(2026, 3, 22, 15, 0, 0)); // Wed
    const mon = startOfUTCISOWeek(wed);
    expect(mon.toISOString()).toBe("2026-04-20T00:00:00.000Z");
  });
});

describe("digestPeriodKey", () => {
  it("uses calendar day for daily and ISO week string for weekly", () => {
    const t = new Date("2026-04-20T10:00:00.000Z");
    expect(digestPeriodKey("daily", t, "UTC")).toBe("2026-04-20");
    expect(digestPeriodKey("weekly", t, "UTC")).toBe("2026-W17");
  });
});
