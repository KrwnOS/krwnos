/**
 * S3-compatible object storage for BackupService (AWS S3, Cloudflare R2, MinIO).
 * URIs are canonical `s3://<bucket>/<key>` for manifests and retention deletes.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { BackupStorage } from "./backup";

const S3_URI_RE = /^s3:\/\/([^/]+)\/(.+)$/;

export function parseS3Uri(uri: string): { bucket: string; key: string } {
  const m = S3_URI_RE.exec(uri);
  if (!m) {
    throw new Error(`invalid s3 storage uri: ${uri}`);
  }
  return { bucket: m[1]!, key: m[2]! };
}

export interface ReadS3BackupEnvResult {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  keyPrefix: string;
  forcePathStyle: boolean;
}

/**
 * Returns null when automated S3 backups are disabled (incomplete env).
 * Accepts either KRWN_BACKUP_S3_* or standard AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.
 */
export function readS3BackupEnv(): ReadS3BackupEnvResult | null {
  const bucket = process.env.KRWN_BACKUP_S3_BUCKET?.trim();
  if (!bucket) return null;

  const accessKeyId =
    process.env.KRWN_BACKUP_S3_ACCESS_KEY_ID?.trim() ||
    process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey =
    process.env.KRWN_BACKUP_S3_SECRET_ACCESS_KEY?.trim() ||
    process.env.AWS_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) return null;

  const region = process.env.KRWN_BACKUP_S3_REGION?.trim() || "auto";
  const endpoint = process.env.KRWN_BACKUP_S3_ENDPOINT?.trim() || undefined;
  const keyPrefix = (
    process.env.KRWN_BACKUP_S3_PREFIX?.trim() || "krwn-backups"
  ).replace(/\/$/, "");
  const forcePathStyle =
    process.env.KRWN_BACKUP_S3_FORCE_PATH_STYLE === "1" ||
    process.env.KRWN_BACKUP_S3_FORCE_PATH_STYLE === "true";

  return {
    bucket,
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
    keyPrefix,
    forcePathStyle,
  };
}

export function createS3ClientFromBackupEnv(
  env: ReadS3BackupEnvResult,
): S3Client {
  return new S3Client({
    region: env.region,
    endpoint: env.endpoint,
    forcePathStyle: env.forcePathStyle,
    credentials: {
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
    },
  });
}

export interface CreateS3BackupStorageOptions {
  client: S3Client;
  bucket: string;
  /** Prefix without leading/trailing slash; keys are `${prefix}/${filename}`. */
  keyPrefix: string;
}

export function createS3BackupStorage(
  opts: CreateS3BackupStorageOptions,
): BackupStorage {
  const prefix = opts.keyPrefix.replace(/\/$/, "");
  return {
    write: async (filename, bytes) => {
      const key = `${prefix}/${filename}`;
      await opts.client.send(
        new PutObjectCommand({
          Bucket: opts.bucket,
          Key: key,
          Body: Buffer.from(bytes),
          ContentType: "application/json",
        }),
      );
      const uri = `s3://${opts.bucket}/${key}`;
      return { uri, sizeBytes: bytes.byteLength };
    },
    read: async (uri) => {
      const { bucket, key } = parseS3Uri(uri);
      const out = await opts.client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (!out.Body) {
        throw new Error(`s3 get empty body: ${uri}`);
      }
      const arr = await out.Body.transformToByteArray();
      return new Uint8Array(arr);
    },
  };
}

export async function deleteS3BackupObject(
  client: S3Client,
  uri: string,
): Promise<void> {
  const { bucket, key } = parseS3Uri(uri);
  await client.send(
    new DeleteObjectCommand({ Bucket: bucket, Key: key }),
  );
}
