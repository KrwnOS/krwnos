/**
 * BullMQ worker — processes scheduled KrwnOS background tasks.
 *
 * Job names (must match schedulers in `registerJobSchedulers`):
 *   - treasury-tick
 *   - proposal-expirer
 *   - invitation-reaper
 *   - auto-promotion
 *   - role-tax-monthly
 *   - node-subscription-tick
 *   - payroll-periodic
 *   - backup-daily
 *   - activity-log-reaper
 *   - email-digest-daily
 *   - email-digest-weekly
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
  runNodeSubscriptionJob,
  runPayrollPeriodicJob,
  runActivityLogReaper,
  runEmailDigestJob,
  runTreasuryWatchTick,
} from "./tasks";

export const JOB_NAMES = {
  treasuryTick: "treasury-tick",
  proposalExpirer: "proposal-expirer",
  invitationReaper: "invitation-reaper",
  autoPromotion: "auto-promotion",
  roleTaxMonthly: "role-tax-monthly",
  nodeSubscriptionTick: "node-subscription-tick",
  payrollPeriodic: "payroll-periodic",
  backupDaily: "backup-daily",
  activityLogReaper: "activity-log-reaper",
  emailDigestDaily: "email-digest-daily",
  emailDigestWeekly: "email-digest-weekly",
} as const;

export interface KrwnJobPayload {
  /** Optional scope for treasury sync (matches CLI `--state`). */
  stateId?: string;
  /** Override UTC month key `YYYY-MM` for role tax idempotency (tests / backfill). */
  roleTaxPeriodKey?: string;
  /** Anchor instant when deriving default `periodKey` from the calendar month. */
  roleTaxNowIso?: string;
  /** Override UTC month key `YYYY-MM` for payroll idempotency (tests / backfill). */
  payrollPeriodKey?: string;
  payrollNowIso?: string;
  /** Anchor for node-subscription period keys (tests). */
  nodeSubscriptionNowIso?: string;
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
  const nodeSubCron =
    process.env.KRWN_JOB_NODE_SUBSCRIPTION_CRON?.trim() || "0 2 * * *";
  const nodeSubTz =
    process.env.KRWN_JOB_NODE_SUBSCRIPTION_TZ?.trim() || "UTC";
  await queue.upsertJobScheduler(
    "krwn-sched:node-subscription-tick",
    { pattern: nodeSubCron, tz: nodeSubTz },
    {
      name: JOB_NAMES.nodeSubscriptionTick,
      data: {} satisfies KrwnJobPayload,
    },
  );
  const payrollCron =
    process.env.KRWN_JOB_PAYROLL_CRON?.trim() || "0 8 15 * *";
  const payrollTz = process.env.KRWN_JOB_PAYROLL_TZ?.trim() || "UTC";
  await queue.upsertJobScheduler(
    "krwn-sched:payroll-periodic",
    { pattern: payrollCron, tz: payrollTz },
    {
      name: JOB_NAMES.payrollPeriodic,
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
  const activityReaperCron =
    process.env.KRWN_JOB_ACTIVITY_REAPER_CRON?.trim() || "30 4 * * *";
  const activityReaperTz =
    process.env.KRWN_JOB_ACTIVITY_REAPER_TZ?.trim() || "UTC";
  await queue.upsertJobScheduler(
    "krwn-sched:activity-log-reaper",
    { pattern: activityReaperCron, tz: activityReaperTz },
    {
      name: JOB_NAMES.activityLogReaper,
      data: {} satisfies KrwnJobPayload,
    },
  );
  const digestDailyCron =
    process.env.KRWN_JOB_EMAIL_DIGEST_DAILY_CRON?.trim() || "0 8 * * *";
  const digestDailyTz =
    process.env.KRWN_JOB_EMAIL_DIGEST_DAILY_TZ?.trim() || "UTC";
  await queue.upsertJobScheduler(
    "krwn-sched:email-digest-daily",
    { pattern: digestDailyCron, tz: digestDailyTz },
    {
      name: JOB_NAMES.emailDigestDaily,
      data: {} satisfies KrwnJobPayload,
    },
  );
  const digestWeeklyCron =
    process.env.KRWN_JOB_EMAIL_DIGEST_WEEKLY_CRON?.trim() || "0 8 * * 1";
  const digestWeeklyTz =
    process.env.KRWN_JOB_EMAIL_DIGEST_WEEKLY_TZ?.trim() || "UTC";
  await queue.upsertJobScheduler(
    "krwn-sched:email-digest-weekly",
    { pattern: digestWeeklyCron, tz: digestWeeklyTz },
    {
      name: JOB_NAMES.emailDigestWeekly,
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
    case JOB_NAMES.nodeSubscriptionTick:
      return runNodeSubscriptionJob({
        nowIso: job.data?.nodeSubscriptionNowIso,
      });
    case JOB_NAMES.payrollPeriodic:
      return runPayrollPeriodicJob({
        payrollPeriodKey: job.data?.payrollPeriodKey,
        payrollNowIso: job.data?.payrollNowIso,
      });
    case JOB_NAMES.backupDaily:
      return runDailyBackup(prisma);
    case JOB_NAMES.activityLogReaper:
      return runActivityLogReaper();
    case JOB_NAMES.emailDigestDaily:
      return runEmailDigestJob({ kind: "daily" });
    case JOB_NAMES.emailDigestWeekly:
      return runEmailDigestJob({ kind: "weekly" });
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
