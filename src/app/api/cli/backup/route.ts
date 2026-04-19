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
import { BackupService, BACKUP_SCHEMA_REV } from "@/core/backup";
import type {
  BackupPayload,
  BackupSource,
  BackupStorage,
  BackupSink,
} from "@/core/backup";
import { authenticateCli, requireScope, CliAuthError } from "../auth";

const source: BackupSource = {
  collectState: async (stateId) => {
    const s = await prisma.state.findUniqueOrThrow({
      where: { id: stateId },
      include: { owner: { select: { handle: true } } },
    });
    return {
      id: s.id,
      slug: s.slug,
      name: s.name,
      description: s.description,
      config: s.config as unknown as BackupPayload["state"]["config"],
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      ownerHandle: s.owner.handle,
    };
  },
  collectVertical: async (stateId) =>
    prisma.verticalNode.findMany({
      where: { stateId },
      orderBy: [{ parentId: "asc" }, { order: "asc" }],
    }) as unknown as BackupPayload["vertical"],
  collectMemberships: async (stateId) => {
    const rows = await prisma.membership.findMany({
      where: { node: { stateId } },
      include: { user: { select: { handle: true } } },
    });
    return rows.map((m) => ({
      userHandle: m.user.handle,
      nodeId: m.nodeId,
      title: m.title,
    }));
  },
  collectModules: async (stateId) => {
    const rows = await prisma.installedModule.findMany({ where: { stateId } });
    return rows.map((m) => ({
      slug: m.slug,
      version: m.version,
      enabled: m.enabled,
      config: m.config as Record<string, unknown>,
    }));
  },
  collectInvitations: async (stateId) => {
    const rows = await prisma.invitation.findMany({
      where: { stateId, status: "active" },
    });
    return rows.map((i) => ({
      code: i.code,
      label: i.label,
      targetNodeId: i.targetNodeId,
      maxUses: i.maxUses,
      expiresAt: i.expiresAt?.toISOString() ?? null,
    }));
  },
};

/** In-memory storage — returns a data: URI. Replace for prod. */
const storage: BackupStorage = {
  write: async (filename, bytes) => ({
    uri: `data:application/json;name=${encodeURIComponent(filename)};base64,${Buffer.from(bytes).toString("base64")}`,
    sizeBytes: bytes.byteLength,
  }),
  read: async (uri) => {
    const match = /^data:[^;]+;(?:name=[^;]+;)?base64,(.+)$/.exec(uri);
    if (!match) throw new Error("unsupported storage uri");
    return new Uint8Array(Buffer.from(match[1]!, "base64"));
  },
};

const sink: BackupSink = {
  recordManifest: async (params) => {
    await prisma.backupManifest.create({
      data: {
        stateId: params.stateId,
        storageUri: params.storageUri,
        schemaRev: params.schemaRev,
        sizeBytes: BigInt(params.sizeBytes),
        checksum: params.checksum,
      },
    });
  },
  restore: async () => {
    throw new Error("Restore must be invoked from a dedicated endpoint.");
  },
};

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
