/**
 * Task bodies invoked by the BullMQ worker and (where noted) by legacy CLIs.
 */
import { InMemoryEventBus } from "@/core/event-bus";
import { prisma } from "@/lib/prisma";
import { createPrismaWatcherPersistence } from "@/modules/wallet/repo";
import { TreasuryWatcher, type WatcherTickReport } from "@/modules/wallet/watcher";
import { buildGovernanceServiceForJobs } from "./governance-factory";

export interface TreasuryWatchTaskOptions {
  stateId?: string;
  /** Poll interval is ignored for a one-shot tick; kept for log parity. */
  intervalMs?: number;
  dustThreshold?: number;
}

function numberEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * One treasury sync pass (balances + on-chain tx reconcile).
 * Uses an in-memory bus like `scripts/treasury-watcher.ts` so the
 * standalone script does not depend on Redis pub/sub.
 */
export async function runTreasuryWatchTick(
  opts: TreasuryWatchTaskOptions = {},
): Promise<WatcherTickReport> {
  const persistence = createPrismaWatcherPersistence(prisma);
  const bus = new InMemoryEventBus();
  const watcher = new TreasuryWatcher({
    persistence,
    bus,
    stateId: opts.stateId,
    intervalMs: opts.intervalMs ?? numberEnv("KRWN_WATCHER_INTERVAL_MS", 30_000),
    dustThreshold:
      opts.dustThreshold ?? numberEnv("KRWN_WATCHER_DUST_THRESHOLD", 0),
  });
  return watcher.tick();
}

/** Closes overdue proposals; auto-executes `auto_dao` winners. */
export async function runProposalExpirer(): Promise<{ closed: number }> {
  const governance = buildGovernanceServiceForJobs();
  const closed = await governance.tickDueProposals();
  return { closed: closed.length };
}

export { runAutoPromotionTick } from "./auto-promotion";

/** Marks expired but still `active` invitations as `expired`. */
export async function runInvitationReaper(): Promise<{ expired: number }> {
  const now = new Date();
  const result = await prisma.invitation.updateMany({
    where: {
      status: "active",
      expiresAt: { not: null, lte: now },
    },
    data: { status: "expired" },
  });
  return { expired: result.count };
}
