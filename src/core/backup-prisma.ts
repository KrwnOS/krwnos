/**
 * Prisma adapters for BackupService — collect, persist manifest, restore.
 * Keeps HTTP routes thin; core does not import `/src/modules`.
 */

import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  BackupPayload,
  BackupSink,
  BackupSource,
  BackupStorage,
} from "./backup";
import { DEFAULT_THEME_CONFIG } from "./theme";

function asDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Same in-memory transport as the CLI backup route (JSON in data: URI). */
export const backupDataUriStorage: BackupStorage = {
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

export function createPrismaBackupSource(prisma: PrismaClient): BackupSource {
  return {
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
        themeConfig: s.themeConfig as unknown as Record<string, unknown>,
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
}

export function createPrismaBackupSink(prisma: PrismaClient): BackupSink {
  return {
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
    restore: async (payload) => {
      await restoreBackupPayload(prisma, payload);
    },
  };
}

/**
 * Re-hydrates rows covered by `BackupPayload` into an **empty** database
 * (no existing `State` with `payload.state.id`). FK order: users → state
 * → vertical (batch by parent) → memberships → modules → invitations.
 */
export async function restoreBackupPayload(
  prisma: PrismaClient,
  payload: BackupPayload,
): Promise<void> {
  if (payload.manifest.stateId !== payload.state.id) {
    throw new Error(
      `Manifest stateId mismatch: ${payload.manifest.stateId} vs ${payload.state.id}`,
    );
  }

  const existing = await prisma.state.findUnique({
    where: { id: payload.state.id },
  });
  if (existing) {
    throw new Error(
      `Refusing restore: State ${payload.state.id} already exists (need empty DB or different snapshot).`,
    );
  }

  const ownerHandle = payload.state.ownerHandle;
  const memberHandles = new Set(
    payload.memberships.map((m) => m.userHandle),
  );
  memberHandles.add(ownerHandle);

  await prisma.$transaction(async (tx) => {
    const handleToUserId = new Map<string, string>();

    for (const h of memberHandles) {
      const user = await tx.user.create({
        data: {
          handle: h,
          displayName: h,
        },
      });
      handleToUserId.set(h, user.id);
    }

    const ownerId = handleToUserId.get(ownerHandle);
    if (!ownerId) throw new Error("owner user missing after restore");

    const themeConfig: Prisma.InputJsonValue =
      payload.state.themeConfig !== undefined
        ? (payload.state.themeConfig as Prisma.InputJsonValue)
        : (DEFAULT_THEME_CONFIG as unknown as Prisma.InputJsonValue);

    await tx.state.create({
      data: {
        id: payload.state.id,
        slug: payload.state.slug,
        name: payload.state.name,
        description: payload.state.description ?? null,
        ownerId,
        config: payload.state.config as unknown as Prisma.InputJsonValue,
        themeConfig,
        createdAt: asDate(payload.state.createdAt),
        updatedAt: asDate(payload.state.updatedAt),
      },
    });

    const vertical = payload.vertical;
    const pending = new Set(vertical.map((n) => n.id));

    while (pending.size > 0) {
      const batch = vertical.filter(
        (n) =>
          pending.has(n.id) &&
          (!n.parentId || !pending.has(n.parentId)),
      );
      if (batch.length === 0) {
        throw new Error(
          "backup restore: vertical tree has a cycle or invalid parent references",
        );
      }
      for (const node of batch) {
        await tx.verticalNode.create({
          data: {
            id: node.id,
            stateId: node.stateId,
            parentId: node.parentId,
            title: node.title,
            type: node.type,
            permissions: node.permissions ?? [],
            order: node.order ?? 0,
            isLobby: (node as { isLobby?: boolean }).isLobby ?? false,
            createdAt: asDate(node.createdAt),
            updatedAt: asDate(node.updatedAt),
          },
        });
        pending.delete(node.id);
      }
    }

    for (const m of payload.memberships) {
      const uid = handleToUserId.get(m.userHandle);
      if (!uid) {
        throw new Error(`restore: unknown user handle ${m.userHandle}`);
      }
      await tx.membership.create({
        data: {
          userId: uid,
          nodeId: m.nodeId,
          title: m.title,
          status: "active",
        },
      });
    }

    for (const mod of payload.modules) {
      await tx.installedModule.create({
        data: {
          stateId: payload.state.id,
          slug: mod.slug,
          version: mod.version,
          enabled: mod.enabled,
          config: mod.config as Prisma.InputJsonValue,
        },
      });
    }

    for (const inv of payload.invitations) {
      const tokenHash = createHash("sha256")
        .update(
          `krwnos:backup:v1:restored:${payload.state.id}:${inv.code}`,
        )
        .digest("hex");
      await tx.invitation.create({
        data: {
          stateId: payload.state.id,
          targetNodeId: inv.targetNodeId,
          createdById: ownerId,
          tokenHash,
          code: inv.code,
          label: inv.label,
          maxUses: inv.maxUses,
          expiresAt: inv.expiresAt ? new Date(inv.expiresAt) : null,
          status: "active",
        },
      });
    }
  });
}
