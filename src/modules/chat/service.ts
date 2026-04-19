/**
 * ChatService — domain logic of the `core.chat` module.
 * ------------------------------------------------------------
 * The service is framework-agnostic: it does not know about
 * Next.js routes, WebSocket transports or Prisma. Everything
 * pluggable is injected:
 *   * `ChatRepository` — persistence.
 *   * `ModuleEventBus` — fan-out of realtime events.
 *   * `PermissionsEngine` + `VerticalSnapshot` — access checks.
 *
 * Canonical event name published on every successful `postMessage`:
 *     "core.chat.message.created"
 *
 * Payload shape: see `ChatMessageCreatedEvent` below.
 */

import { permissionsEngine, type PermissionsEngine } from "@/core/permissions-engine";
import type {
  ModuleEventBus,
  PermissionKey,
  VerticalSnapshot,
} from "@/types/kernel";
import { ChatPermissions } from "./permissions";

// ------------------------------------------------------------
// Domain types
// ------------------------------------------------------------

export interface ChatChannel {
  id: string;
  stateId: string;
  nodeId: string | null;
  slug: string;
  title: string;
  topic: string | null;
  visibility: "public" | "private";
  archived: boolean;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  authorId: string;
  body: string;
  metadata: Record<string, unknown>;
  // Directive flag + origin node (set when a superior issues an order).
  isDirective: boolean;
  directiveFromNode: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
}

/** Ack row exposed to the UI / event payloads. */
export interface ChatDirectiveAck {
  id: string;
  messageId: string;
  userId: string;
  viaNodeId: string | null;
  requiredAt: Date;
  ackedAt: Date | null;
}

/** Aggregated view used by the "pending directives" inbox. */
export interface PendingDirective {
  ack: ChatDirectiveAck;
  message: ChatMessage;
  channel: ChatChannel;
}

/**
 * Per-channel access classification returned to the UI.
 *   * `direct`    — user is a direct member of the channel's bound node.
 *   * `inherited` — user sits above the node (ancestor member).
 *   * `public`    — channel has no node binding (chat.read is enough).
 *   * `sovereign` — user is the State owner.
 */
export type ChannelAccessReason =
  | "direct"
  | "inherited"
  | "public"
  | "sovereign";

export interface ChannelAccessInfo {
  channel: ChatChannel;
  accessReason: ChannelAccessReason;
  /** `true` if the user may issue directives into this channel. */
  canPostDirective: boolean;
}

export interface ChatMessageCreatedEvent {
  stateId: string;
  channelId: string;
  nodeId: string | null;
  message: ChatMessage;
  /**
   * User ids that have read-access to the channel at the moment of
   * publication. Realtime transports use this list to decide which
   * active sessions should receive the event.
   */
  recipientUserIds: string[];
  /**
   * For directive messages, the ack rows the service has just created.
   * Empty array for ordinary messages.
   */
  directiveAcks: ChatDirectiveAck[];
}

export interface ChatDirectiveAckedEvent {
  stateId: string;
  channelId: string;
  messageId: string;
  ack: ChatDirectiveAck;
  /** Same semantics as `ChatMessageCreatedEvent.recipientUserIds` — realtime filter. */
  recipientUserIds: string[];
}

export const CHAT_EVENTS = {
  MessageCreated: "core.chat.message.created",
  ChannelCreated: "core.chat.channel.created",
  DirectiveAcknowledged: "core.chat.directive.acknowledged",
} as const;

// ------------------------------------------------------------
// Repository contract — implemented in `./repo.ts` on top of Prisma.
// Kept narrow so the service is testable against in-memory fakes.
// ------------------------------------------------------------

export interface ChatRepository {
  listChannels(stateId: string): Promise<ChatChannel[]>;
  findChannel(channelId: string): Promise<ChatChannel | null>;
  createChannel(input: {
    stateId: string;
    nodeId: string | null;
    slug: string;
    title: string;
    topic: string | null;
    visibility: "public" | "private";
    createdById: string;
  }): Promise<ChatChannel>;
  insertMessage(input: {
    channelId: string;
    authorId: string;
    body: string;
    metadata: Record<string, unknown>;
    isDirective?: boolean;
    directiveFromNode?: string | null;
  }): Promise<ChatMessage>;
  listMessages(
    channelId: string,
    opts: { limit: number; before?: Date | null },
  ): Promise<ChatMessage[]>;
  findMessage(messageId: string): Promise<ChatMessage | null>;

  /** Creates pending ack rows for a directive. Must be idempotent on conflict. */
  insertDirectiveAcks(
    messageId: string,
    rows: Array<{ userId: string; viaNodeId: string | null }>,
  ): Promise<ChatDirectiveAck[]>;
  listDirectiveAcks(messageId: string): Promise<ChatDirectiveAck[]>;
  /**
   * Marks the ack row for (messageId, userId) as acknowledged. Returns
   * the updated row, or null if the user was never required to ack.
   */
  markDirectiveAcked(
    messageId: string,
    userId: string,
  ): Promise<ChatDirectiveAck | null>;
  listPendingDirectivesForUser(userId: string): Promise<PendingDirective[]>;

  /** Returns the user ids that hold a membership in `nodeId`. */
  listNodeMemberUserIds(nodeId: string): Promise<string[]>;
  /** Returns the user ids that hold memberships in any of the given node ids. */
  listUserIdsInNodes(nodeIds: string[]): Promise<string[]>;
  /** Returns the owner id of the State (Sovereign). */
  getStateOwnerId(stateId: string): Promise<string | null>;
  /**
   * Walks the Vertical from `nodeId` up to the root and returns every
   * ancestor node id (including `nodeId` itself). Used by the service
   * for realtime recipient resolution without loading a full snapshot.
   */
  walkAncestors(nodeId: string): Promise<string[]>;
}

// ------------------------------------------------------------
// Access check helpers
// ------------------------------------------------------------

export interface ChatAccessContext {
  userId: string;
  isOwner: boolean;
  /** Flat snapshot of the Vertical for permission evaluation. */
  snapshot: VerticalSnapshot;
  /**
   * Canonical permissions the user currently holds, pre-computed by
   * `permissionsEngine.resolveAll()`. The service never walks the
   * tree on its own — it only consults these two values + the snapshot.
   */
  permissions: ReadonlySet<PermissionKey>;
}

export class ChatAccessError extends Error {
  constructor(
    message: string,
    public readonly code: "forbidden" | "not_found" | "invalid_input",
  ) {
    super(message);
    this.name = "ChatAccessError";
  }
}

// ------------------------------------------------------------
// Service
// ------------------------------------------------------------

export interface ChatServiceDeps {
  repo: ChatRepository;
  bus: ModuleEventBus;
  engine?: PermissionsEngine;
}

export class ChatService {
  private readonly repo: ChatRepository;
  private readonly bus: ModuleEventBus;
  private readonly engine: PermissionsEngine;

  constructor(deps: ChatServiceDeps) {
    this.repo = deps.repo;
    this.bus = deps.bus;
    this.engine = deps.engine ?? permissionsEngine;
  }

  // --------------------------------------------------------
  // Channels
  // --------------------------------------------------------

  /**
   * Returns every channel the caller is allowed to read in this State,
   * together with the reason access was granted and whether the user
   * may issue directives into it. The UI uses `accessReason` to group
   * channels into "Общие / Мой отдел / Прямые связи".
   */
  async listReadableChannels(
    stateId: string,
    ctx: ChatAccessContext,
  ): Promise<ChannelAccessInfo[]> {
    this.requirePermission(ctx, ChatPermissions.Read);
    const channels = await this.repo.listChannels(stateId);
    const result: ChannelAccessInfo[] = [];
    for (const c of channels) {
      if (c.archived) continue;
      const accessReason = this.classifyAccess(c, ctx);
      if (!accessReason) continue;
      result.push({
        channel: c,
        accessReason,
        canPostDirective: this.canPostDirective(c, ctx),
      });
    }
    return result;
  }

  async createChannel(
    stateId: string,
    ctx: ChatAccessContext,
    input: {
      slug: string;
      title: string;
      nodeId?: string | null;
      topic?: string | null;
      visibility?: "public" | "private";
    },
  ): Promise<ChatChannel> {
    this.requirePermission(ctx, ChatPermissions.Admin);
    if (input.nodeId) {
      const node = ctx.snapshot.nodes.get(input.nodeId);
      if (!node || node.stateId !== stateId) {
        throw new ChatAccessError(
          `Node "${input.nodeId}" does not belong to this State.`,
          "invalid_input",
        );
      }
    }
    const channel = await this.repo.createChannel({
      stateId,
      nodeId: input.nodeId ?? null,
      slug: input.slug,
      title: input.title,
      topic: input.topic ?? null,
      visibility: input.visibility ?? "public",
      createdById: ctx.userId,
    });
    await this.bus.emit(CHAT_EVENTS.ChannelCreated, {
      stateId,
      channelId: channel.id,
      nodeId: channel.nodeId,
    });
    return channel;
  }

  // --------------------------------------------------------
  // Messages
  // --------------------------------------------------------

  async listMessages(
    channelId: string,
    ctx: ChatAccessContext,
    opts: { limit?: number; before?: Date | null } = {},
  ): Promise<ChatMessage[]> {
    const channel = await this.loadReadableChannel(channelId, ctx);
    return this.repo.listMessages(channel.id, {
      limit: clampLimit(opts.limit),
      before: opts.before ?? null,
    });
  }

  async postMessage(
    channelId: string,
    ctx: ChatAccessContext,
    input: { body: string; metadata?: Record<string, unknown> },
  ): Promise<ChatMessage> {
    return this.writeMessage(channelId, ctx, input, {
      isDirective: false,
    });
  }

  /**
   * Publishes a message marked as a Directive («Приказ»). The author
   * must satisfy `canPostDirective` (strictly higher node in the
   * Vertical, or the Sovereign). The service additionally creates one
   * `ChatDirectiveAck` row per subordinate recipient and propagates
   * them as part of the realtime event so the UI can immediately show
   * the "Принято к исполнению" prompt.
   */
  async postDirective(
    channelId: string,
    ctx: ChatAccessContext,
    input: { body: string; metadata?: Record<string, unknown> },
  ): Promise<ChatMessage> {
    const channel = await this.loadReadableChannel(channelId, ctx);
    if (!this.canPostDirective(channel, ctx)) {
      throw new ChatAccessError(
        "Directives can only be issued from a higher node in the Vertical.",
        "forbidden",
      );
    }
    const senderNodeId = this.pickDirectiveSenderNode(channel, ctx);
    return this.writeMessage(channelId, ctx, input, {
      isDirective: true,
      directiveFromNode: senderNodeId,
    });
  }

  /**
   * Marks a directive as "Принято к исполнению" for the current user.
   * Idempotent: re-acking returns the existing row unchanged.
   */
  async acknowledgeDirective(
    messageId: string,
    ctx: ChatAccessContext,
  ): Promise<ChatDirectiveAck> {
    this.requirePermission(ctx, ChatPermissions.Read);
    const message = await this.repo.findMessage(messageId);
    if (!message || !message.isDirective) {
      throw new ChatAccessError("Directive not found.", "not_found");
    }
    const ack = await this.repo.markDirectiveAcked(messageId, ctx.userId);
    if (!ack) {
      throw new ChatAccessError(
        "You are not required to acknowledge this directive.",
        "forbidden",
      );
    }
    const channel = await this.repo.findChannel(message.channelId);
    if (channel) {
      const recipientUserIds = await this.collectRecipients(channel);
      void this.bus
        .emit<ChatDirectiveAckedEvent>(CHAT_EVENTS.DirectiveAcknowledged, {
          stateId: channel.stateId,
          channelId: channel.id,
          messageId: message.id,
          ack,
          recipientUserIds,
        })
        .catch(() => {});
    }
    return ack;
  }

  async listPendingDirectives(
    ctx: ChatAccessContext,
  ): Promise<PendingDirective[]> {
    this.requirePermission(ctx, ChatPermissions.Read);
    return this.repo.listPendingDirectivesForUser(ctx.userId);
  }

  // --------------------------------------------------------
  // Internals
  // --------------------------------------------------------

  /** Picks the sender node id for directive attribution: the highest
   *  of the sender's memberships that's still an ancestor of the
   *  channel's bound node. Falls back to the first membership or null.
   */
  private pickDirectiveSenderNode(
    channel: ChatChannel,
    ctx: ChatAccessContext,
  ): string | null {
    if (!channel.nodeId) {
      const member = ctx.snapshot.membershipsByUser.get(ctx.userId);
      return member ? [...member][0] ?? null : null;
    }
    const ancestors = this.ancestorIds(channel.nodeId, ctx.snapshot);
    const member = ctx.snapshot.membershipsByUser.get(ctx.userId);
    if (!member) return null;
    for (const nodeId of member) {
      if (ancestors.has(nodeId)) return nodeId;
    }
    return null;
  }

  /**
   * Computes the list of subordinate user ids that must acknowledge a
   * directive.
   *   * For node-bound channels: recipients sitting at the channel's
   *     node or any of its descendants (peers in ancestor nodes are
   *     excluded — they don't owe the sender an ack).
   *   * For unbound channels: all recipients except the sender.
   */
  private pickSubordinateRecipients(
    channel: ChatChannel,
    ctx: ChatAccessContext,
    recipientUserIds: readonly string[],
  ): Array<{ userId: string; viaNodeId: string | null }> {
    if (!channel.nodeId) {
      return recipientUserIds
        .filter((uid) => uid !== ctx.userId)
        .map((userId) => ({ userId, viaNodeId: null }));
    }
    const bucket = this.descendantIds(channel.nodeId, ctx.snapshot);
    bucket.add(channel.nodeId);

    const rows: Array<{ userId: string; viaNodeId: string | null }> = [];
    for (const uid of recipientUserIds) {
      if (uid === ctx.userId) continue;
      const memberships = ctx.snapshot.membershipsByUser.get(uid);
      if (!memberships) continue;
      let viaNodeId: string | null = null;
      for (const n of memberships) {
        if (bucket.has(n)) {
          viaNodeId = n;
          break;
        }
      }
      if (viaNodeId) rows.push({ userId: uid, viaNodeId });
    }
    return rows;
  }

  /** Set of nodeId + every ancestor (exclusive of the node itself). */
  private ancestorIds(nodeId: string, snapshot: VerticalSnapshot): Set<string> {
    const out = new Set<string>();
    const visited = new Set<string>();
    let cursor: string | null | undefined =
      snapshot.nodes.get(nodeId)?.parentId ?? null;
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      out.add(cursor);
      cursor = snapshot.nodes.get(cursor)?.parentId ?? null;
    }
    return out;
  }

  /** Set of every descendant of `nodeId` (exclusive of itself). */
  private descendantIds(nodeId: string, snapshot: VerticalSnapshot): Set<string> {
    // Build a children index once — O(N) in the number of nodes.
    const children = new Map<string, string[]>();
    for (const node of snapshot.nodes.values()) {
      if (!node.parentId) continue;
      const list = children.get(node.parentId);
      if (list) list.push(node.id);
      else children.set(node.parentId, [node.id]);
    }
    const out = new Set<string>();
    const stack = [...(children.get(nodeId) ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (out.has(id)) continue;
      out.add(id);
      for (const ch of children.get(id) ?? []) stack.push(ch);
    }
    return out;
  }

  /** Shared pipeline for `postMessage` / `postDirective`. */
  private async writeMessage(
    channelId: string,
    ctx: ChatAccessContext,
    input: { body: string; metadata?: Record<string, unknown> },
    opts: { isDirective: boolean; directiveFromNode?: string | null },
  ): Promise<ChatMessage> {
    this.requirePermission(ctx, ChatPermissions.Write);

    const channel = await this.loadReadableChannel(channelId, ctx);

    const body = input.body.trim();
    if (!body) {
      throw new ChatAccessError("Message body is empty.", "invalid_input");
    }
    if (body.length > 8000) {
      throw new ChatAccessError("Message exceeds 8000 chars.", "invalid_input");
    }

    const message = await this.repo.insertMessage({
      channelId: channel.id,
      authorId: ctx.userId,
      body,
      metadata: input.metadata ?? {},
      isDirective: opts.isDirective,
      directiveFromNode: opts.directiveFromNode ?? null,
    });

    const recipientUserIds = await this.collectRecipients(channel);

    let directiveAcks: ChatDirectiveAck[] = [];
    if (opts.isDirective) {
      const subordinates = this.pickSubordinateRecipients(
        channel,
        ctx,
        recipientUserIds,
      );
      directiveAcks = subordinates.length
        ? await this.repo.insertDirectiveAcks(message.id, subordinates)
        : [];
    }

    const event: ChatMessageCreatedEvent = {
      stateId: channel.stateId,
      channelId: channel.id,
      nodeId: channel.nodeId,
      message,
      recipientUserIds,
      directiveAcks,
    };

    void this.bus.emit(CHAT_EVENTS.MessageCreated, event).catch(() => {});
    return message;
  }

  // --------------------------------------------------------
  // Access classification
  // --------------------------------------------------------

  /**
   * Consolidated access check for a channel. Applies permission gate
   * AND (for node-bound channels) the Permissions Engine's
   * member-or-ancestor rule.
   */
  canReadChannel(channel: ChatChannel, ctx: ChatAccessContext): boolean {
    return this.classifyAccess(channel, ctx) !== null;
  }

  /**
   * Detailed classification used by both `listReadableChannels` and
   * `canReadChannel`. Returns `null` when access is denied.
   */
  classifyAccess(
    channel: ChatChannel,
    ctx: ChatAccessContext,
  ): ChannelAccessReason | null {
    if (ctx.isOwner) return "sovereign";
    if (!hasPermission(ctx.permissions, ChatPermissions.Read)) return null;
    if (!channel.nodeId) return "public";

    const res = this.engine.isMemberOfNodeOrAncestor(
      { userId: ctx.userId, isOwner: ctx.isOwner, snapshot: ctx.snapshot },
      channel.nodeId,
    );
    if (!res.granted) return null;
    return res.reason === "direct" ? "direct" : "inherited";
  }

  /**
   * A directive can be posted when:
   *   * The sender is the Sovereign, OR
   *   * The channel is node-bound and the sender sits STRICTLY ABOVE
   *     the channel's node (inherited access), OR
   *   * The channel is unbound and the sender holds `chat.admin`.
   *
   * Peer-to-peer directives ("same rank") are forbidden on purpose —
   * an order must come from a higher node in the Vertical.
   */
  canPostDirective(channel: ChatChannel, ctx: ChatAccessContext): boolean {
    if (ctx.isOwner) return true;
    if (!hasPermission(ctx.permissions, ChatPermissions.Write)) return false;
    if (!channel.nodeId) {
      return hasPermission(ctx.permissions, ChatPermissions.Admin);
    }
    const memberNodes =
      ctx.snapshot.membershipsByUser.get(ctx.userId) ?? new Set<string>();
    if (memberNodes.size === 0) return false;
    const ancestors = this.ancestorIds(channel.nodeId, ctx.snapshot);
    for (const n of memberNodes) {
      if (ancestors.has(n)) return true;
    }
    return false;
  }

  private async loadReadableChannel(
    channelId: string,
    ctx: ChatAccessContext,
  ): Promise<ChatChannel> {
    const channel = await this.repo.findChannel(channelId);
    if (!channel || channel.archived) {
      throw new ChatAccessError("Channel not found.", "not_found");
    }
    if (!this.canReadChannel(channel, ctx)) {
      throw new ChatAccessError("Not a member of this channel.", "forbidden");
    }
    return channel;
  }

  private requirePermission(ctx: ChatAccessContext, key: PermissionKey): void {
    if (ctx.isOwner) return;
    if (!hasPermission(ctx.permissions, key)) {
      throw new ChatAccessError(`Missing permission "${key}".`, "forbidden");
    }
  }

  /**
   * Resolve the list of user ids that should receive realtime events
   * for this channel. For node-bound channels that's the union of
   * memberships of the node and all of its ancestors; for unbound
   * channels the transport falls back to filtering by `chat.read`
   * at connection time (we cannot enumerate "anyone who holds a
   * permission" without scanning the whole State).
   */
  private async collectRecipients(channel: ChatChannel): Promise<string[]> {
    const owners = new Set<string>();
    const ownerId = await this.repo.getStateOwnerId(channel.stateId);
    if (ownerId) owners.add(ownerId);

    if (!channel.nodeId) {
      // Unbound channel → the transport will do the filtering.
      return [...owners];
    }

    // Walk ancestors client-side from the snapshot… but we don't have
    // a snapshot at publish-time. Instead we ask the repo for every
    // node in the ancestor chain. The chain is derived by reading
    // parentIds from the persisted `VerticalNode` table.
    // This is intentionally done via the repository to keep the
    // service free of Prisma imports.
    const chain = await this.repo.walkAncestors(channel.nodeId);
    const users = await this.repo.listUserIdsInNodes(chain);
    for (const u of users) owners.add(u);
    return [...owners];
  }
}

function hasPermission(
  held: ReadonlySet<PermissionKey>,
  required: PermissionKey,
): boolean {
  if (held.has("*")) return true;
  if (held.has(required)) return true;
  const [domain] = required.split(".");
  if (!domain) return false;
  return held.has(`${domain}.*` as PermissionKey);
}

function clampLimit(n: number | undefined): number {
  if (!n || n <= 0) return 50;
  return Math.min(n, 200);
}
