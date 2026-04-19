/**
 * Prisma-backed `ActivityRepository`.
 * ------------------------------------------------------------
 * Держим в core рядом с `activity-feed.ts` — так модули получают
 * готовый «плагин» без необходимости лезть в Prisma. Паттерн
 * зеркалит `state-config-prisma.ts` и `exchange-prisma.ts`.
 */

import type { PrismaClient } from "@prisma/client";
import type {
  ActivityLog,
  ActivityRepository,
  ActivityVisibility,
  RecordActivityInput,
} from "./activity-feed";

export function createPrismaActivityRepository(
  prisma: PrismaClient,
): ActivityRepository {
  return {
    async insert(input: RecordActivityInput): Promise<ActivityLog> {
      const row = await prisma.activityLog.create({
        data: {
          stateId: input.stateId,
          event: input.event,
          category: input.category,
          titleKey: input.titleKey,
          titleParams: (input.titleParams ?? {}) as object,
          actorId: input.actorId ?? null,
          nodeId: input.nodeId ?? null,
          visibility: input.visibility ?? "public",
          audienceUserIds: input.audienceUserIds ?? [],
          metadata: (input.metadata ?? {}) as object,
        },
      });
      return toDomain(row);
    },

    async listByState(
      stateId: string,
      opts: {
        limit: number;
        before: Date | null;
        category: string | null;
        event?: string | null;
        actorId?: string | null;
      },
    ): Promise<ActivityLog[]> {
      const rows = await prisma.activityLog.findMany({
        where: {
          stateId,
          ...(opts.before ? { createdAt: { lt: opts.before } } : {}),
          ...(opts.category ? { category: opts.category } : {}),
          ...(opts.event ? { event: opts.event } : {}),
          ...(opts.actorId ? { actorId: opts.actorId } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: opts.limit,
      });
      return rows.map(toDomain);
    },
  };
}

// Prisma row → domain. Keeps the union-typed `visibility` narrow
// without trusting raw DB strings blindly.
function toDomain(row: {
  id: string;
  stateId: string;
  event: string;
  category: string;
  titleKey: string;
  titleParams: unknown;
  actorId: string | null;
  nodeId: string | null;
  visibility: string;
  audienceUserIds: string[];
  metadata: unknown;
  createdAt: Date;
}): ActivityLog {
  return {
    id: row.id,
    stateId: row.stateId,
    event: row.event,
    category: row.category,
    titleKey: row.titleKey,
    titleParams: (row.titleParams as Record<string, unknown>) ?? {},
    actorId: row.actorId,
    nodeId: row.nodeId,
    visibility: normaliseVisibility(row.visibility),
    audienceUserIds: row.audienceUserIds,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.createdAt,
  };
}

function normaliseVisibility(value: string): ActivityVisibility {
  switch (value) {
    case "public":
    case "node":
    case "audience":
    case "sovereign":
      return value;
    default:
      return "public";
  }
}
