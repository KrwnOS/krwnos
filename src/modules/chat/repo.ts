/**
 * Prisma adapter for `ChatRepository`.
 * ------------------------------------------------------------
 * The `ChatService` never imports Prisma directly. This file is the
 * only bridge between the module and the database — swap it out in
 * tests for an in-memory fake.
 */

import type { PrismaClient } from "@prisma/client";
import type {
  ChatChannel,
  ChatDirectiveAck,
  ChatMessage,
  ChatRepository,
  PendingDirective,
} from "./service";

export function createPrismaChatRepository(prisma: PrismaClient): ChatRepository {
  return {
    async listChannels(stateId: string): Promise<ChatChannel[]> {
      const rows = await prisma.chatChannel.findMany({
        where: { stateId },
        orderBy: [{ archived: "asc" }, { createdAt: "asc" }],
      });
      return rows.map(mapChannel);
    },

    async findChannel(channelId: string): Promise<ChatChannel | null> {
      const row = await prisma.chatChannel.findUnique({ where: { id: channelId } });
      return row ? mapChannel(row) : null;
    },

    async createChannel(input): Promise<ChatChannel> {
      const row = await prisma.chatChannel.create({
        data: {
          stateId: input.stateId,
          nodeId: input.nodeId,
          slug: input.slug,
          title: input.title,
          topic: input.topic,
          visibility: input.visibility,
          createdById: input.createdById,
        },
      });
      return mapChannel(row);
    },

    async insertMessage(input): Promise<ChatMessage> {
      const row = await prisma.chatMessage.create({
        data: {
          channelId: input.channelId,
          authorId: input.authorId,
          body: input.body,
          metadata: input.metadata as object,
          isDirective: input.isDirective ?? false,
          directiveFromNode: input.directiveFromNode ?? null,
        },
      });
      return mapMessage(row);
    },

    async listMessages(channelId, { limit, before }): Promise<ChatMessage[]> {
      const rows = await prisma.chatMessage.findMany({
        where: {
          channelId,
          deletedAt: null,
          ...(before ? { createdAt: { lt: before } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return rows.map(mapMessage).reverse();
    },

    async findMessage(messageId: string): Promise<ChatMessage | null> {
      const row = await prisma.chatMessage.findUnique({ where: { id: messageId } });
      return row ? mapMessage(row) : null;
    },

    async insertDirectiveAcks(messageId, rows): Promise<ChatDirectiveAck[]> {
      if (rows.length === 0) return [];
      // `createMany` skips existing rows on @@unique conflict, making
      // the ack insertion idempotent even if the directive is retried.
      await prisma.chatDirectiveAck.createMany({
        data: rows.map((r) => ({
          messageId,
          userId: r.userId,
          viaNodeId: r.viaNodeId,
        })),
        skipDuplicates: true,
      });
      const inserted = await prisma.chatDirectiveAck.findMany({
        where: { messageId },
      });
      return inserted.map(mapAck);
    },

    async listDirectiveAcks(messageId): Promise<ChatDirectiveAck[]> {
      const rows = await prisma.chatDirectiveAck.findMany({ where: { messageId } });
      return rows.map(mapAck);
    },

    async markDirectiveAcked(messageId, userId): Promise<ChatDirectiveAck | null> {
      const row = await prisma.chatDirectiveAck.findUnique({
        where: { messageId_userId: { messageId, userId } },
      });
      if (!row) return null;
      if (row.ackedAt) return mapAck(row);
      const updated = await prisma.chatDirectiveAck.update({
        where: { messageId_userId: { messageId, userId } },
        data: { ackedAt: new Date() },
      });
      return mapAck(updated);
    },

    async listPendingDirectivesForUser(userId): Promise<PendingDirective[]> {
      const rows = await prisma.chatDirectiveAck.findMany({
        where: { userId, ackedAt: null },
        orderBy: { requiredAt: "desc" },
        include: { message: { include: { channel: true } } },
      });
      return rows.map((r) => ({
        ack: mapAck(r),
        message: mapMessage(r.message),
        channel: mapChannel(r.message.channel),
      }));
    },

    async listNodeMemberUserIds(nodeId) {
      const rows = await prisma.membership.findMany({
        where: { nodeId },
        select: { userId: true },
      });
      return rows.map((r) => r.userId);
    },

    async listUserIdsInNodes(nodeIds) {
      if (nodeIds.length === 0) return [];
      const rows = await prisma.membership.findMany({
        where: { nodeId: { in: nodeIds } },
        select: { userId: true },
      });
      return [...new Set(rows.map((r) => r.userId))];
    },

    async getStateOwnerId(stateId) {
      const row = await prisma.state.findUnique({
        where: { id: stateId },
        select: { ownerId: true },
      });
      return row?.ownerId ?? null;
    },

    async walkAncestors(nodeId) {
      // Iterative climb — Postgres recursive CTE would be faster but
      // the Vertical rarely exceeds a handful of levels.
      const chain: string[] = [];
      const visited = new Set<string>();
      let cursor: string | null = nodeId;
      while (cursor && !visited.has(cursor)) {
        visited.add(cursor);
        chain.push(cursor);
        const row: { parentId: string | null } | null =
          await prisma.verticalNode.findUnique({
            where: { id: cursor },
            select: { parentId: true },
          });
        cursor = row?.parentId ?? null;
      }
      return chain;
    },
  };
}

// ------------------------------------------------------------
// Row mappers keep Prisma types out of the public ChatService API.
// ------------------------------------------------------------

type PrismaChatChannelRow = {
  id: string;
  stateId: string;
  nodeId: string | null;
  slug: string;
  title: string;
  topic: string | null;
  visibility: string;
  archived: boolean;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
};

type PrismaChatMessageRow = {
  id: string;
  channelId: string;
  authorId: string;
  body: string;
  metadata: unknown;
  isDirective: boolean;
  directiveFromNode: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
};

type PrismaChatAckRow = {
  id: string;
  messageId: string;
  userId: string;
  viaNodeId: string | null;
  requiredAt: Date;
  ackedAt: Date | null;
};

function mapChannel(row: PrismaChatChannelRow): ChatChannel {
  return {
    id: row.id,
    stateId: row.stateId,
    nodeId: row.nodeId,
    slug: row.slug,
    title: row.title,
    topic: row.topic,
    visibility: row.visibility === "private" ? "private" : "public",
    archived: row.archived,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapMessage(row: PrismaChatMessageRow): ChatMessage {
  return {
    id: row.id,
    channelId: row.channelId,
    authorId: row.authorId,
    body: row.body,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    isDirective: row.isDirective,
    directiveFromNode: row.directiveFromNode,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    deletedAt: row.deletedAt,
  };
}

function mapAck(row: PrismaChatAckRow): ChatDirectiveAck {
  return {
    id: row.id,
    messageId: row.messageId,
    userId: row.userId,
    viaNodeId: row.viaNodeId,
    requiredAt: row.requiredAt,
    ackedAt: row.ackedAt,
  };
}
