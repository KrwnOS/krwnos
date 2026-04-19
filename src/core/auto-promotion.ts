/**
 * Pure rules for StateSettings-driven auto-promotion of memberships.
 * Cron job applies these after loading wallet + membership rows from Prisma.
 */
import { Decimal } from "@prisma/client/runtime/library";

const MS_PER_DAY = 86_400_000;

/** Whole calendar days between two instants (floor), UTC. */
export function fullDaysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * Whether a membership row should move to `autoPromotionTargetNodeId`.
 * Requires at least one of `minBalance` / `minDays` to be set; otherwise
 * promotion never runs (ambiguous config).
 *
 * When **both** thresholds are set, either satisfied condition is enough
 * (see `StateSettings` comment: first fulfilled criterion promotes).
 */
export function shouldPromoteMembershipForAutoPromotion(params: {
  minBalance: number | null;
  minDays: number | null;
  /** Primary-asset PERSONAL wallet balance for this user in the State. */
  primaryBalance: Decimal;
  membershipCreatedAt: Date;
  now: Date;
}): boolean {
  const { minBalance, minDays, primaryBalance, membershipCreatedAt, now } =
    params;

  if (minBalance === null && minDays === null) {
    return false;
  }

  const balanceOk =
    minBalance !== null && primaryBalance.gte(new Decimal(minBalance));
  const daysOk =
    minDays !== null &&
    fullDaysBetween(membershipCreatedAt, now) >= minDays;

  if (minBalance !== null && minDays !== null) {
    return balanceOk || daysOk;
  }
  if (minBalance !== null) {
    return balanceOk;
  }
  return daysOk;
}
