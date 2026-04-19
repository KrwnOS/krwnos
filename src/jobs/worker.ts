/**
 * BullMQ worker — processes scheduled KrwnOS background tasks.
 *
 * Job names (must match schedulers in `registerJobSchedulers`):
 *   - treasury-tick
 *   - proposal-expirer
 *   - invitation-reaper
 *   - auto-promotion
 *   - role-tax-monthly
 *   - backup-daily
 */
import { Queue, Worker } from "bullmq";
import type { Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { createRedisForBullmq } from "./redis-connection";
import { KRWN_JOB_QUEUE } from "./queue-name";
import {
  runAutoPromotionTick,
  runDailyBackup,
  runInvitationReaper,
  runProposalExpirer,
  runRoleTaxMonthlyJob,
  runTreasuryWatchTick,
} from "./tasks";

export const JOB_NAMES = {
  treasuryTick: "treasury-tick",
  proposalExpirer: "proposal-expirer",
  invitationReaper: "invitation-reaper",
  autoPromotion: "auto-promotion",
  roleTaxMonthly: "role-tax-monthly",
  backupDaily: "backup-daily",
} as const;

export interface KrwnJobPayload {
  /** Optional scope for treasury sync (matches CLI `--state`). */
  stateId?: string;
  /** Override UTC month key `YYYY-MM` for role tax idempotency (tests / backfill). */
  roleTaxPeriodKey?: string;
  /** Anchor instant when deriving default `periodKey` from the calendar month. */
  roleTaxNowIso?: string;
}

function numberEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Registers repeatable job schedulers (idempotent upsert).
 * Call from a single leader process (see `KRWN_JOB_LEADER`).
 */
export async function registerJobSchedulers(queue: Queue): Promise<void> {
  const treasuryEvery = numberEnv("KRWN_JOB_TREASURY_EVERY_MS", 30_000);
  const proposalEvery = numberEnv("KRWN_JOB_PROPOSAL_EVERY_MS", 60_000);
  const invitationEvery = numberEnv("KRWN_JOB_INVITATION_EVERY_MS", 60_000);
  const autoPromotionEvery = numberEnv(
    "KRWN_JOB_AUTO_PROMOTION_EVERY_MS",
    300_000,
  );

  await queue.upsertJobScheduler(
    "krwn-sched:treasury-tick",
    { every: treasuryEvery },
    {
      name: JOB_NAMES.treasuryTick,
      data: {} satisfies KrwnJobPayload,
    },
  );
  await queue.upsertJobScheduler(
    "krwn-sched:proposal-expirer",
    { every: proposalEvery },
    {
      name: JOB_NAMES.proposalExpirer,
      data: {} satisfies KrwnJobPayload,
    },
  );
  await queue.upsertJobScheduler(
    "krwn-sched:invitation-reaper",
    { every: invitationEvery },
    {
      name: JOB_NAMES.invitationReaper,
      data: {} satisfies KrwnJobPayload,
    },
  );
  await queue.upsertJobScheduler(
    "krwn-sched:auto-promotion",
    { every: autoPromotionEvery },
    {
      name: JOB_NAMES.autoPromotion,
      data: {} satisfies KrwnJobPayload,
    },
  );
  const roleTaxCron =
    process.env.KRWN_JOB_ROLE_TAX_CRON?.trim() || "0 0 1 * *";
  const roleTaxTz = process.env.KRWN_JOB_ROLE_TAX_TZ?.trim() || "UTC";
  await queue.upsertJobScheduler(
    "krwn-sched:role-tax-monthly",
    { pattern: roleTaxCron, tz: roleTaxTz },
    {
      name: JOB_NAMES.roleTaxMonthly,
      data: {} satisfies KrwnJobPayload,
    },
  );
  const backupCron =
    process.env.KRWN_JOB_BACKUP_CRON?.trim() || "0 3 * * *";
  const backupTz = process.env.KRWN_JOB_BACKUP_TZ?.trim() || "UTC";
  await queue.upsertJobScheduler(
    "krwn-sched:backup-daily",
    { pattern: backupCron, tz: backupTz },
    {
      name: JOB_NAMES.backupDaily,
      data: {} satisfies KrwnJobPayload,
    },
  );
}

async function processJob(job: Job<KrwnJobPayload>): Promise<unknown> {
  switch (job.name) {
    case JOB_NAMES.treasuryTick:
      return runTreasuryWatchTick({ stateId: job.data?.stateId });
    case JOB_NAMES.proposalExpirer:
      return runProposalExpirer();
    case JOB_NAMES.invitationReaper:
      return runInvitationReaper();
    case JOB_NAMES.autoPromotion:
      return runAutoPromotionTick();
    case JOB_NAMES.roleTaxMonthly:
      return runRoleTaxMonthlyJob({
        roleTaxPeriodKey: job.data?.roleTaxPeriodKey,
        roleTaxNowIso: job.data?.roleTaxNowIso,
      });
    case JOB_NAMES.backupDaily:
      return runDailyBackup(prisma);
    default:
      throw new Error(`Unknown job name: ${job.name}`);
  }
}

export interface RunKrwnJobWorkerOptions {
  connection: ReturnType<typeof createRedisForBullmq>;
}

/**
 * Starts a worker; returns shutdown function.
 */
export function runKrwnJobWorker(
  opts: RunKrwnJobWorkerOptions,
): { worker: Worker<KrwnJobPayload>; close: () => Promise<void> } {
  const worker = new Worker<KrwnJobPayload>(
    KRWN_JOB_QUEUE,
    async (job) => processJob(job),
    { connection: opts.connection },
  );

  const close = async () => {
    await worker.close();
  };

  return { worker, close };
}

export async function shutdownJobRuntime(
  closeWorker: () => Promise<void>,
  queue: Queue,
  connection: ReturnType<typeof createRedisForBullmq>,
): Promise<void> {
  await closeWorker();
  await queue.close();
  await connection.quit();
  await prisma.$disconnect();
}
