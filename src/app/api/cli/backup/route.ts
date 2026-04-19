/**
 * POST /api/cli/backup  — create a full snapshot of the current State.
 * GET  /api/cli/backup  — list previous backup manifests.
 *
 * The JSON payload of the backup is streamed back to the CLI in
 * the `201 Created` body; the manifest row is also persisted so
 * the Sovereign can audit historical backups.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimitedResponse } from "@/lib/rate-limit";
import { BackupService, BACKUP_SCHEMA_REV } from "@/core/backup";
import {
  backupDataUriStorage,
  createPrismaBackupSink,
  createPrismaBackupSource,
} from "@/core/backup-prisma";
import { authenticateCli, requireScope, CliAuthError } from "../auth";

const source = createPrismaBackupSource(prisma);
const sink = createPrismaBackupSink(prisma);
const storage = backupDataUriStorage;

const service = new BackupService(source, sink, storage);

const lookup = {
  findByHash: async (tokenHash: string) =>
    prisma.cliToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        stateId: true,
        scopes: true,
        expiresAt: true,
        revokedAt: true,
      },
    }),
  touch: async (id: string) =>
    void (await prisma.cliToken.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    })),
};

export async function GET(req: NextRequest) {
  const limited = await rateLimitedResponse(req, "api_cli");
  if (limited) return limited;

  try {
    const ctx = await authenticateCli(req, lookup);
    requireScope(ctx, "backup.read");
    if (!ctx.stateId) return badRequest("Token is not scoped to any State");

    const rows = await prisma.backupManifest.findMany({
      where: { stateId: ctx.stateId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json({
      schemaRev: BACKUP_SCHEMA_REV,
      backups: rows.map((r) => ({
        id: r.id,
        storageUri: r.storageUri,
        checksum: r.checksum,
        sizeBytes: r.sizeBytes.toString(),
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  const limited = await rateLimitedResponse(req, "api_cli");
  if (limited) return limited;

  try {
    const ctx = await authenticateCli(req, lookup);
    requireScope(ctx, "backup.create");
    if (!ctx.stateId) return badRequest("Token is not scoped to any State");

    const result = await service.create(ctx.stateId);

    return NextResponse.json(
      {
        uri: result.uri,
        sizeBytes: result.sizeBytes,
        checksum: result.checksum,
        payload: result.payload,
      },
      { status: 201 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

function badRequest(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

function errorResponse(err: unknown) {
  if (err instanceof CliAuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : "internal error" },
    { status: 500 },
  );
}
