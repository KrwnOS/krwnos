/**
 * Daily snapshot to S3/R2 via BackupService + BackupManifest, with retention.
 */
import type { S3Client } from "@aws-sdk/client-s3";
import type { PrismaClient } from "@prisma/client";
import { BackupService } from "@/core/backup";
import {
  createPrismaBackupSink,
  createPrismaBackupSource,
} from "@/core/backup-prisma";
import {
  createS3BackupStorage,
  createS3ClientFromBackupEnv,
  deleteS3BackupObject,
  readS3BackupEnv,
} from "@/core/backup-s3-storage";
import { logger } from "@/lib/logger";

function numberEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export interface RunDailyBackupResult {
  skipped?: boolean;
  reason?: string;
  states: Array<{
    stateId: string;
    ok: boolean;
    error?: string;
    created?: { uri: string; sizeBytes: number };
    pruned?: number;
  }>;
}

/**
 * For each State: create JSON snapshot in configured S3/R2, persist manifest,
 * then drop older manifests beyond retention (and delete remote objects for `s3://` URIs).
 */
export async function runDailyBackup(
  prisma: PrismaClient,
): Promise<RunDailyBackupResult> {
  const env = readS3BackupEnv();
  if (!env) {
    return {
      skipped: true,
      reason: "KRWN_BACKUP_S3_BUCKET + credentials not configured",
      states: [],
    };
  }

  /** Keep N newest per state; 0 disables pruning (see env docs). */
  const retentionCount = Math.floor(
    numberEnv("KRWN_BACKUP_RETENTION_COUNT", 14),
  );
  const client = createS3ClientFromBackupEnv(env);
  const storage = createS3BackupStorage({
    client,
    bucket: env.bucket,
    keyPrefix: env.keyPrefix,
  });
  const source = createPrismaBackupSource(prisma);
  const sink = createPrismaBackupSink(prisma);
  const service = new BackupService(source, sink, storage);

  const states = await prisma.state.findMany({ select: { id: true } });
  const log = logger.child({ job: "backup-daily" });
  const out: RunDailyBackupResult["states"] = [];

  for (const { id: stateId } of states) {
    try {
      const created = await service.create(stateId);
      let pruned = 0;
      if (retentionCount > 0) {
        pruned = await pruneBackupManifests(
          prisma,
          client,
          stateId,
          retentionCount,
        );
      }
      out.push({
        stateId,
        ok: true,
        created: {
          uri: created.uri,
          sizeBytes: created.sizeBytes,
        },
        pruned,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ stateId, err: message }, "backup-daily: state failed");
      out.push({ stateId, ok: false, error: message });
    }
  }

  return { states: out };
}

async function pruneBackupManifests(
  prisma: PrismaClient,
  client: S3Client,
  stateId: string,
  keepCount: number,
): Promise<number> {
  const rows = await prisma.backupManifest.findMany({
    where: { stateId },
    orderBy: { createdAt: "desc" },
    select: { id: true, storageUri: true },
  });
  const victims = rows.slice(keepCount);
  let deleted = 0;
  const log = logger.child({ job: "backup-daily", stateId });

  for (const row of victims) {
    try {
      if (row.storageUri.startsWith("s3://")) {
        await deleteS3BackupObject(client, row.storageUri);
      }
      await prisma.backupManifest.delete({ where: { id: row.id } });
      deleted++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(
        { manifestId: row.id, storageUri: row.storageUri, err: message },
        "retention: failed to prune manifest",
      );
    }
  }

  return deleted;
}
