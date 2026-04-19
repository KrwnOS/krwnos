/**
 * KrwnOS BullMQ job runner (Horizon 1 — §3 Job runner).
 *
 * Schedules and executes:
 *   - treasury-tick       — on-chain treasury sync (`TreasuryWatcher.tick`)
 *   - proposal-expirer      — `GovernanceService.tickDueProposals`
 *   - invitation-reaper     — `Invitation` rows past `expiresAt` → `expired`
 *   - auto-promotion        — `StateSettings` thresholds → `Membership.nodeId`
 *   - role-tax-monthly      — `StateSettings.roleTaxRate` → root treasury (cron)
 *   - backup-daily          — `BackupService` snapshot → S3/R2 + manifest retention
 *
 * Usage:
 *   npm run worker:jobs
 *
 * Env:
 *   REDIS_URL                    Redis for BullMQ (required in production)
 *   KRWN_JOB_LEADER              If `0`, do not register schedulers (scale-out replicas)
 *   KRWN_JOB_TREASURY_EVERY_MS   treasury repeat interval (default 30000)
 *   KRWN_JOB_PROPOSAL_EVERY_MS   proposal expirer (default 60000)
 *   KRWN_JOB_INVITATION_EVERY_MS invitation reaper (default 60000)
 *   KRWN_JOB_AUTO_PROMOTION_EVERY_MS auto-promotion (default 300000)
 *   KRWN_JOB_ROLE_TAX_CRON        cron for role tax (default `0 0 1 * *`, 1st 00:00)
 *   KRWN_JOB_ROLE_TAX_TZ          IANA tz for cron (default UTC)
 *   KRWN_JOB_BACKUP_CRON          daily backup (default `0 3 * * *`)
 *   KRWN_JOB_BACKUP_TZ            IANA tz for backup cron (default UTC)
 *   KRWN_BACKUP_S3_*              bucket, keys, endpoint — see `.env.example`
 *
 * The process handles SIGINT / SIGTERM and closes the worker cleanly.
 */

import { Queue } from "bullmq";
import { getActivityFeed } from "@/server/activity-boot";
import { createRedisForBullmq } from "@/jobs/redis-connection";
import { KRWN_JOB_QUEUE } from "@/jobs/queue-name";
import {
  registerJobSchedulers,
  runKrwnJobWorker,
  shutdownJobRuntime,
} from "@/jobs/worker";

function log(msg: string): void {
  const ts = new Date().toISOString();
  // eslint-disable-next-line no-console
  console.log(`[job-worker] ${ts} ${msg}`);
}

const isLeader = process.env.KRWN_JOB_LEADER !== "0";

async function main(): Promise<void> {
  void getActivityFeed();

  const connection = createRedisForBullmq();
  const queue = new Queue(KRWN_JOB_QUEUE, { connection });

  if (isLeader) {
    await registerJobSchedulers(queue);
    log("registered job schedulers (leader)");
  } else {
    log("KRWN_JOB_LEADER=0 — skipping scheduler registration");
  }

  const { close } = runKrwnJobWorker({ connection });

  log(`listening on queue "${KRWN_JOB_QUEUE}"`);

  const shutdown = async (signal: string) => {
    log(`received ${signal}, shutting down…`);
    await shutdownJobRuntime(close, queue, connection);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[job-worker] fatal:", err);
  process.exit(1);
});
