/**
 * Time windows and idempotency period keys for email digest jobs.
 *
 * Daily key: civil date in `KRWN_JOB_EMAIL_DIGEST_DAILY_TZ` at the enqueue instant.
 * Weekly key: ISO week (year + week number, UTC) of the enqueue instant — align the
 * cron with the week boundary you care about (e.g. Monday 08:00 UTC); see
 * `docs/DEPLOYMENT.md`.
 */

export type DigestKind = "daily" | "weekly";

export interface DigestWindow {
  start: Date;
  end: Date;
}

/** Rolling lookback from `end` (job run time). */
export function digestTimeWindow(
  kind: DigestKind,
  end: Date,
): DigestWindow {
  const ms = kind === "daily" ? 86_400_000 : 7 * 86_400_000;
  return { start: new Date(end.getTime() - ms), end };
}

/** YYYY-MM-DD in IANA time zone (for daily idempotency). */
export function calendarDateKeyInTimeZone(d: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${day}`;
}

/** Monday 00:00:00.000 UTC of the ISO week that contains UTC calendar `d`. */
export function startOfUTCISOWeek(d: Date): Date {
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const day = date.getUTCDay(); // 0 Sun .. 6 Sat
  const diff = day === 0 ? -6 : 1 - day; // move to Monday
  date.setUTCDate(date.getUTCDate() + diff);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

/**
 * ISO-8601 week number (UTC) and ISO week-year (not always equal to calendar year
 * of `d` near Jan 1).
 */
export function getISOWeekYearAndWeekUTC(d: Date): { weekYear: number; week: number } {
  const monday = startOfUTCISOWeek(d);
  const thursday = new Date(monday.getTime() + 3 * 86_400_000);
  const weekYear = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(weekYear, 0, 4));
  const week1Monday = startOfUTCISOWeek(jan4);
  const week =
    Math.floor((monday.getTime() - week1Monday.getTime()) / 604_800_000) + 1;
  return { weekYear, week };
}

/**
 * ISO week idempotency key (UTC), e.g. `2026-W16`.
 * Align the weekly BullMQ cron with the week boundaries you want (e.g. Monday 08:00 UTC).
 */
export function utcIsoWeekPeriodKey(d: Date): string {
  const { weekYear, week } = getISOWeekYearAndWeekUTC(d);
  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

export function digestPeriodKey(
  kind: DigestKind,
  at: Date,
  dailyTimeZone: string,
): string {
  if (kind === "daily") {
    return calendarDateKeyInTimeZone(at, dailyTimeZone);
  }
  return utcIsoWeekPeriodKey(at);
}
