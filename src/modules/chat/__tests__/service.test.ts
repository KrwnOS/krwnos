/**
 * Unit tests for ChatService against an in-memory ChatRepository.
 *
 * The service is framework-agnostic, so everything it needs (repo,
 * event bus, permissions engine) is a plain object here. The tests
 * exercise the canonical permission rules defined in `service.ts`:
 *
 *   * `chat.read`   — required to list / read messages;
 *   * `chat.write`  — required to post messages (ordinary or directive);
 *   * `chat.admin`  — required to create channels;
 *   * node-bound channels ALSO require membership in the node or any
 *     of its ancestors (delegated to PermissionsEngine);
 *   * directives must originate STRICTLY above the channel's node,
 *     or from the Sovereign;
 *   * the Sovereign (`isOwner`) bypasses every check.
 */

import { describe, expect, it } from "vitest";
import {
  CHAT_EVENTS,
  ChatAccessError,
  ChatService,
  type ChannelAccessReason,
  type ChatAccessContext,
  type ChatChannel,
  type ChatDirectiveAck,
  type ChatMessage,
  type ChatMessageCreatedEvent,
  type ChatRepository,
  type PendingDirective,
} from "../service";
import { ChatPermissions } from "../permissions";
import type {
  ModuleEventBus,
  PermissionKey,
  VerticalNode,
  VerticalSnapshot,
} from "@/types/kernel";

// ------------------------------------------------------------
// Fixtures: a tiny Vertical
//
//   root                         (no perms, no members)
//   └── ministry                 (chat.read, chat.write)  ← MINISTER_ID
//        └── office              (chat.admin)             ← CLERK_ID
//
// Sovereign owns State `s1`. OUTSIDER has no membership.
// ------------------------------------------------------------

const STATE_ID = "s1";
const OWNER_ID = "u-sovereign";
const MINISTER_ID = "u-minister";
const CLERK_ID = "u-clerk";
const OUTSIDER_ID = "u-outsider";

const ROOT_NODE_ID = "n-root";
const MINISTRY_NODE_ID = "n-ministry";
const OFFICE_NODE_ID = "n-office";

function buildSnapshot(): VerticalSnapshot {
  const nodes = new Map<string, VerticalNode>();
  const now = new Date("2026-01-01T00:00:00Z");

  const root: VerticalNode = {
    id: ROOT_NODE_ID,
    stateId: STATE_ID,
    parentId: null,
    title: "Государство",
    type: "department",
    permissions: [],
    order: 0,
    createdAt: now,
    updatedAt: now,
  };
  const ministry: VerticalNode = {
    ...root,
    id: MINISTRY_NODE_ID,
    parentId: ROOT_NODE_ID,
    title: "Минфин",
    permissions: [ChatPermissions.Read, ChatPermissions.Write],
  };
  const office: VerticalNode = {
    ...root,
    id: OFFICE_NODE_ID,
    parentId: MINISTRY_NODE_ID,
    title: "Отдел казны",
    type: "position",
    permissions: [ChatPermissions.Admin],
  };

  nodes.set(root.id, root);
  nodes.set(ministry.id, ministry);
  nodes.set(office.id, office);

  const membershipsByUser = new Map<string, Set<string>>();
  membershipsByUser.set(MINISTER_ID, new Set([MINISTRY_NODE_ID]));
  membershipsByUser.set(CLERK_ID, new Set([OFFICE_NODE_ID]));

  return { stateId: STATE_ID, nodes, membershipsByUser };
}

function buildCtx(
  userId: string,
  opts: { isOwner?: boolean; extraPermissions?: PermissionKey[] } = {},
): ChatAccessContext {
  const snapshot = buildSnapshot();
  const permissions = new Set<PermissionKey>(opts.extraPermissions ?? []);

  if (opts.isOwner) {
    permissions.add("*");
  } else if (userId === MINISTER_ID) {
    // Inherits ministry node's perms.
    permissions.add(ChatPermissions.Read);
    permissions.add(ChatPermissions.Write);
  } else if (userId === CLERK_ID) {
    // Office grants admin; ancestor ministry grants read/write.
    permissions.add(ChatPermissions.Read);
    permissions.add(ChatPermissions.Write);
    permissions.add(ChatPermissions.Admin);
  }

  return {
    userId,
    isOwner: opts.isOwner ?? false,
    snapshot,
    permissions,
  };
}

// ------------------------------------------------------------
// In-memory ChatRepository — mirrors the Prisma adapter surface
// documented in `ChatRepository` from `service.ts`.
// ------------------------------------------------------------

interface InMemoryRepoSeed {
  channels?: ChatChannel[];
  messages?: ChatMessage[];
  membershipsByUser?: Map<string, Set<string>>;
  parentByNode?: Map<string, string | null>;
  stateOwnerId?: string | null;
}

interface InMemoryRepoHandles {
  repo: ChatRepository;
  channels: Map<string, ChatChannel>;
  messages: ChatMessage[];
  acks: ChatDirectiveAck[];
}

function createInMemoryRepo(seed: InMemoryRepoSeed = {}): InMemoryRepoHandles {
  const channels = new Map<string, ChatChannel>();
  for (const c of seed.channels ?? []) {
    channels.set(c.id, { ...c });
  }
  const messages: ChatMessage[] = (seed.messages ?? []).map((m) => ({ ...m }));
  const acks: ChatDirectiveAck[] = [];

  let channelCounter = channels.size + 1;
  let messageCounter = messages.length + 1;
  let ackCounter = 1;

  const membershipsByUser = seed.membershipsByUser ?? new Map();
  const parentByNode = seed.parentByNode ?? new Map();

  const repo: ChatRepository = {
    async listChannels(stateId) {
      return [...channels.values()].filter((c) => c.stateId === stateId);
    },
    async findChannel(id) {
      const row = channels.get(id);
      return row ? { ...row } : null;
    },
    async createChannel(input) {
      const id = `c-${channelCounter++}`;
      const now = new Date();
      const channel: ChatChannel = {
        id,
        stateId: input.stateId,
        nodeId: input.nodeId,
        slug: input.slug,
        title: input.title,
        topic: input.topic,
        visibility: input.visibility,
        archived: false,
        createdById: input.createdById,
        createdAt: now,
        updatedAt: now,
      };
      channels.set(id, channel);
      return { ...channel };
    },
    async insertMessage(input) {
      const message: ChatMessage = {
        id: `m-${messageCounter++}`,
        channelId: input.channelId,
        authorId: input.authorId,
        body: input.body,
        metadata: input.metadata,
        isDirective: input.isDirective ?? false,
        directiveFromNode: input.directiveFromNode ?? null,
        createdAt: new Date(),
        editedAt: null,
        deletedAt: null,
      };
      messages.push(message);
      return { ...message };
    },
    async listMessages(channelId, { limit, before }) {
      const filtered = messages
        .filter(
          (m) =>
            m.channelId === channelId &&
            !m.deletedAt &&
            (!before || m.createdAt < before),
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      // Match the Prisma adapter semantics: take the latest `limit`
      // rows (sorted desc, then reversed back to asc).
      return filtered.slice(-limit).map((m) => ({ ...m }));
    },
    async findMessage(id) {
      const row = messages.find((m) => m.id === id);
      return row ? { ...row } : null;
    },
    async insertDirectiveAcks(messageId, rows) {
      const created: ChatDirectiveAck[] = [];
      for (const row of rows) {
        const existing = acks.find(
          (a) => a.messageId === messageId && a.userId === row.userId,
        );
        if (existing) {
          created.push({ ...existing });
          continue;
        }
        const ack: ChatDirectiveAck = {
          id: `a-${ackCounter++}`,
          messageId,
          userId: row.userId,
          viaNodeId: row.viaNodeId,
          requiredAt: new Date(),
          ackedAt: null,
        };
        acks.push(ack);
        created.push({ ...ack });
      }
      return created;
    },
    async listDirectiveAcks(messageId) {
      return acks
        .filter((a) => a.messageId === messageId)
        .map((a) => ({ ...a }));
    },
    async markDirectiveAcked(messageId, userId) {
      const ack = acks.find(
        (a) => a.messageId === messageId && a.userId === userId,
      );
      if (!ack) return null;
      if (!ack.ackedAt) ack.ackedAt = new Date();
      return { ...ack };
    },
    async listPendingDirectivesForUser(userId) {
      const out: PendingDirective[] = [];
      for (const ack of acks) {
        if (ack.userId !== userId || ack.ackedAt) continue;
        const message = messages.find((m) => m.id === ack.messageId);
        if (!message) continue;
        const channel = channels.get(message.channelId);
        if (!channel) continue;
        out.push({ ack: { ...ack }, message: { ...message }, channel: { ...channel } });
      }
      return out;
    },
    async listNodeMemberUserIds(nodeId) {
      const result: string[] = [];
      for (const [userId, nodes] of membershipsByUser) {
        if (nodes.has(nodeId)) result.push(userId);
      }
      return result;
    },
    async listUserIdsInNodes(nodeIds) {
      if (nodeIds.length === 0) return [];
      const set = new Set<string>();
      for (const [userId, nodes] of membershipsByUser) {
        for (const nodeId of nodeIds) {
          if (nodes.has(nodeId)) {
            set.add(userId);
            break;
          }
        }
      }
      return [...set];
    },
    async getStateOwnerId() {
      return seed.stateOwnerId ?? null;
    },
    async walkAncestors(nodeId) {
      const chain: string[] = [];
      const visited = new Set<string>();
      let cursor: string | null | undefined = nodeId;
      while (cursor && !visited.has(cursor)) {
        visited.add(cursor);
        chain.push(cursor);
        cursor = parentByNode.get(cursor) ?? null;
      }
      return chain;
    },
  };

  return { repo, channels, messages, acks };
}

// ------------------------------------------------------------
// Recording event bus
// ------------------------------------------------------------

interface RecordedEvent {
  event: string;
  payload: unknown;
}

function createRecordingBus(opts: { throwOnEmit?: boolean } = {}): {
  bus: ModuleEventBus;
  events: RecordedEvent[];
} {
  const events: RecordedEvent[] = [];
  const bus: ModuleEventBus = {
    async emit(event, payload) {
      if (opts.throwOnEmit) {
        throw new Error("bus unavailable");
      }
      events.push({ event, payload });
    },
    on() {
      return () => undefined;
    },
  };
  return { bus, events };
}

// Post-emit microtask/macrotask flush — `writeMessage` uses
// `void this.bus.emit(...).catch(() => {})`, so we must let the
// microtask + timers queue drain before asserting.
async function flush(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}

// ------------------------------------------------------------
// Channel + message factories
// ------------------------------------------------------------

function makeChannel(overrides: Partial<ChatChannel> & { id: string }): ChatChannel {
  const now = new Date("2026-02-01T00:00:00Z");
  return {
    stateId: STATE_ID,
    nodeId: null,
    slug: overrides.id,
    title: overrides.id,
    topic: null,
    visibility: "public",
    archived: false,
    createdById: OWNER_ID,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function parentLinks(): Map<string, string | null> {
  return new Map<string, string | null>([
    [OFFICE_NODE_ID, MINISTRY_NODE_ID],
    [MINISTRY_NODE_ID, ROOT_NODE_ID],
    [ROOT_NODE_ID, null],
  ]);
}

function baseSeed(
  channels: ChatChannel[],
  overrides: Partial<InMemoryRepoSeed> = {},
): InMemoryRepoSeed {
  return {
    channels,
    membershipsByUser: new Map([
      [MINISTER_ID, new Set([MINISTRY_NODE_ID])],
      [CLERK_ID, new Set([OFFICE_NODE_ID])],
    ]),
    parentByNode: parentLinks(),
    stateOwnerId: OWNER_ID,
    ...overrides,
  };
}

// ------------------------------------------------------------
// Tests
// ------------------------------------------------------------

describe("ChatService.listReadableChannels", () => {
  const openChannel = makeChannel({ id: "c-open", nodeId: null });
  const ministryChannel = makeChannel({
    id: "c-ministry",
    nodeId: MINISTRY_NODE_ID,
  });
  const officeChannel = makeChannel({ id: "c-office", nodeId: OFFICE_NODE_ID });
  const archivedChannel = makeChannel({
    id: "c-archived",
    nodeId: null,
    archived: true,
  });

  function build() {
    const { repo } = createInMemoryRepo(
      baseSeed([openChannel, ministryChannel, officeChannel, archivedChannel]),
    );
    const { bus } = createRecordingBus();
    return new ChatService({ repo, bus });
  }

  it("requires chat.read", async () => {
    await expect(
      build().listReadableChannels(STATE_ID, buildCtx(OUTSIDER_ID)),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("sovereign sees every non-archived channel with reason=sovereign", async () => {
    const result = await build().listReadableChannels(
      STATE_ID,
      buildCtx(OWNER_ID, { isOwner: true }),
    );
    const byId = new Map(result.map((r) => [r.channel.id, r]));
    expect([...byId.keys()].sort()).toEqual(
      [openChannel.id, ministryChannel.id, officeChannel.id].sort(),
    );
    for (const info of result) {
      expect(info.accessReason).toBe<ChannelAccessReason>("sovereign");
      expect(info.canPostDirective).toBe(true);
    }
  });

  it("minister: ministry=direct, office=inherited (descendant), open=public", async () => {
    // Power flows DOWN the Vertical: a member of `ministry` is an
    // ancestor of `office`, so they see the office channel too.
    const result = await build().listReadableChannels(
      STATE_ID,
      buildCtx(MINISTER_ID),
    );
    const byId = new Map(result.map((r) => [r.channel.id, r]));
    expect([...byId.keys()].sort()).toEqual(
      [openChannel.id, ministryChannel.id, officeChannel.id].sort(),
    );
    expect(byId.get(ministryChannel.id)!.accessReason).toBe("direct");
    expect(byId.get(officeChannel.id)!.accessReason).toBe("inherited");
    expect(byId.get(openChannel.id)!.accessReason).toBe("public");
  });

  it("clerk: office=direct, open=public; ministry channel is NOT visible", async () => {
    // The clerk sits below ministry in the Vertical, and power only
    // flows down — subordinates cannot read their superior's channel.
    const result = await build().listReadableChannels(
      STATE_ID,
      buildCtx(CLERK_ID),
    );
    const byId = new Map(result.map((r) => [r.channel.id, r]));
    expect([...byId.keys()].sort()).toEqual(
      [openChannel.id, officeChannel.id].sort(),
    );
    expect(byId.get(officeChannel.id)!.accessReason).toBe("direct");
    expect(byId.get(openChannel.id)!.accessReason).toBe("public");
    expect(byId.get(ministryChannel.id)).toBeUndefined();
  });

  it("archived channels are filtered out even for the Sovereign", async () => {
    const result = await build().listReadableChannels(
      STATE_ID,
      buildCtx(OWNER_ID, { isOwner: true }),
    );
    expect(result.find((r) => r.channel.id === archivedChannel.id)).toBeUndefined();
  });
});

describe("ChatService.createChannel", () => {
  function build() {
    const { repo, channels } = createInMemoryRepo(baseSeed([]));
    const { bus, events } = createRecordingBus();
    return {
      service: new ChatService({ repo, bus }),
      channels,
      events,
    };
  }

  it("requires chat.admin (minister cannot create)", async () => {
    const { service } = build();
    await expect(
      service.createChannel(STATE_ID, buildCtx(MINISTER_ID), {
        slug: "news",
        title: "News",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("creates an unbound channel and emits ChannelCreated", async () => {
    const { service, channels, events } = build();
    const channel = await service.createChannel(
      STATE_ID,
      buildCtx(CLERK_ID),
      { slug: "news", title: "News" },
    );
    expect(channel.stateId).toBe(STATE_ID);
    expect(channel.nodeId).toBeNull();
    expect(channel.visibility).toBe("public");
    expect(channel.createdById).toBe(CLERK_ID);
    expect(channels.get(channel.id)).toBeDefined();
    expect(events).toEqual([
      {
        event: CHAT_EVENTS.ChannelCreated,
        payload: { stateId: STATE_ID, channelId: channel.id, nodeId: null },
      },
    ]);
  });

  it("creates a node-bound channel when nodeId belongs to the State", async () => {
    const { service } = build();
    const channel = await service.createChannel(
      STATE_ID,
      buildCtx(CLERK_ID),
      { slug: "finance", title: "Finance", nodeId: MINISTRY_NODE_ID },
    );
    expect(channel.nodeId).toBe(MINISTRY_NODE_ID);
  });

  it("rejects nodeId that does not exist in the snapshot", async () => {
    const { service } = build();
    await expect(
      service.createChannel(STATE_ID, buildCtx(CLERK_ID), {
        slug: "ghost",
        title: "Ghost",
        nodeId: "n-nonexistent",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("sovereign can create even without explicit chat.admin", async () => {
    const { service } = build();
    const channel = await service.createChannel(
      STATE_ID,
      buildCtx(OWNER_ID, { isOwner: true }),
      { slug: "royal", title: "Royal" },
    );
    expect(channel.createdById).toBe(OWNER_ID);
  });
});

describe("ChatService.postMessage", () => {
  const openChannel = makeChannel({ id: "c-open", nodeId: null });
  const ministryChannel = makeChannel({
    id: "c-ministry",
    nodeId: MINISTRY_NODE_ID,
  });

  function build(overrides: Partial<InMemoryRepoSeed> = {}) {
    const handles = createInMemoryRepo(
      baseSeed([openChannel, ministryChannel], overrides),
    );
    const { bus, events } = createRecordingBus();
    return {
      service: new ChatService({ repo: handles.repo, bus }),
      events,
      ...handles,
    };
  }

  it("requires chat.write", async () => {
    const { service } = build();
    await expect(
      service.postMessage(openChannel.id, buildCtx(OUTSIDER_ID), {
        body: "hi",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rejects a non-existent channel with not_found", async () => {
    const { service } = build();
    await expect(
      service.postMessage("c-missing", buildCtx(MINISTER_ID), { body: "hi" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects a member-less user on a node-bound channel", async () => {
    const { service } = build();
    const ctx = buildCtx(OUTSIDER_ID, {
      extraPermissions: [ChatPermissions.Read, ChatPermissions.Write],
    });
    await expect(
      service.postMessage(ministryChannel.id, ctx, { body: "hello" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rejects empty / whitespace-only bodies", async () => {
    const { service } = build();
    await expect(
      service.postMessage(openChannel.id, buildCtx(MINISTER_ID), {
        body: "   \n\t ",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("rejects bodies longer than 8000 chars", async () => {
    const { service } = build();
    await expect(
      service.postMessage(openChannel.id, buildCtx(MINISTER_ID), {
        body: "x".repeat(8001),
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("trims the body, persists the message and emits MessageCreated (unbound channel)", async () => {
    const { service, messages, events } = build();
    const msg = await service.postMessage(
      openChannel.id,
      buildCtx(MINISTER_ID),
      { body: "  hello  " },
    );
    expect(msg.body).toBe("hello");
    expect(msg.authorId).toBe(MINISTER_ID);
    expect(msg.isDirective).toBe(false);
    expect(msg.directiveFromNode).toBeNull();
    expect(messages).toHaveLength(1);

    await flush();

    expect(events).toHaveLength(1);
    const [evt] = events;
    expect(evt!.event).toBe(CHAT_EVENTS.MessageCreated);
    const payload = evt!.payload as ChatMessageCreatedEvent;
    expect(payload.stateId).toBe(STATE_ID);
    expect(payload.channelId).toBe(openChannel.id);
    expect(payload.nodeId).toBeNull();
    // Unbound → transport-side filtering, only the owner is enumerated.
    expect(payload.recipientUserIds).toEqual([OWNER_ID]);
    expect(payload.directiveAcks).toEqual([]);
  });

  it("resolves recipients from ancestor walk for a node-bound channel", async () => {
    const { service, events } = build();
    await service.postMessage(ministryChannel.id, buildCtx(MINISTER_ID), {
      body: "update",
    });
    await flush();

    const payload = events[0]!.payload as ChatMessageCreatedEvent;
    // walkAncestors(ministry) = [ministry, root];
    // memberships ∩ ancestors = {MINISTER_ID};
    // plus the State owner.
    expect([...payload.recipientUserIds].sort()).toEqual(
      [OWNER_ID, MINISTER_ID].sort(),
    );
  });

  it("swallows event-bus failures so the DB write still succeeds", async () => {
    const { repo } = createInMemoryRepo(baseSeed([openChannel]));
    const { bus } = createRecordingBus({ throwOnEmit: true });
    const service = new ChatService({ repo, bus });

    const msg = await service.postMessage(
      openChannel.id,
      buildCtx(MINISTER_ID),
      { body: "survives" },
    );
    expect(msg.body).toBe("survives");
  });
});

describe("ChatService.postDirective", () => {
  const ministryChannel = makeChannel({
    id: "c-ministry",
    nodeId: MINISTRY_NODE_ID,
  });
  const officeChannel = makeChannel({ id: "c-office", nodeId: OFFICE_NODE_ID });
  const openChannel = makeChannel({ id: "c-open", nodeId: null });

  function build() {
    const handles = createInMemoryRepo(
      baseSeed([ministryChannel, officeChannel, openChannel]),
    );
    const { bus, events } = createRecordingBus();
    return {
      service: new ChatService({ repo: handles.repo, bus }),
      events,
      ...handles,
    };
  }

  it("sovereign can issue a directive into a node-bound channel", async () => {
    const { service, acks, events } = build();
    const ctx = buildCtx(OWNER_ID, { isOwner: true });
    const msg = await service.postDirective(officeChannel.id, ctx, {
      body: "audit next Monday",
    });

    expect(msg.isDirective).toBe(true);
    await flush();
    const payload = events[0]!.payload as ChatMessageCreatedEvent;
    // Recipients (ancestor walk from office) = owner + minister + clerk.
    // Subordinate-pick keeps only users whose membership intersects
    // {office} ∪ descendants(office) = {office} → CLERK only.
    expect(payload.directiveAcks.map((a) => a.userId)).toEqual([CLERK_ID]);
    expect(acks.map((a) => a.userId)).toEqual([CLERK_ID]);
    expect(acks[0]!.viaNodeId).toBe(OFFICE_NODE_ID);
  });

  it("minister (ancestor of office) can issue a directive into the office channel", async () => {
    const { service, acks } = build();
    const msg = await service.postDirective(
      officeChannel.id,
      buildCtx(MINISTER_ID),
      { body: "deadline moved" },
    );
    expect(msg.isDirective).toBe(true);
    expect(msg.directiveFromNode).toBe(MINISTRY_NODE_ID);
    expect(acks.map((a) => a.userId)).toEqual([CLERK_ID]);
  });

  it("clerk cannot issue a directive into their OWN node (peer-to-peer is forbidden)", async () => {
    const { service } = build();
    await expect(
      service.postDirective(officeChannel.id, buildCtx(CLERK_ID), {
        body: "nope",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("clerk cannot issue a directive into their ancestor's channel (order must flow down)", async () => {
    const { service } = build();
    await expect(
      service.postDirective(ministryChannel.id, buildCtx(CLERK_ID), {
        body: "nope"
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("directive into an unbound channel requires chat.admin", async () => {
    const { service } = build();
    // MINISTER lacks chat.admin → rejected.
    await expect(
      service.postDirective(openChannel.id, buildCtx(MINISTER_ID), {
        body: "nope",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    // CLERK holds chat.admin → allowed.
    const msg = await service.postDirective(
      openChannel.id,
      buildCtx(CLERK_ID),
      { body: "everyone please ack" },
    );
    expect(msg.isDirective).toBe(true);
  });
});

describe("ChatService.acknowledgeDirective", () => {
  const officeChannel = makeChannel({ id: "c-office", nodeId: OFFICE_NODE_ID });

  function buildWithOutstandingDirective() {
    const handles = createInMemoryRepo(baseSeed([officeChannel]));
    const { bus, events } = createRecordingBus();
    const service = new ChatService({ repo: handles.repo, bus });
    return { service, events, ...handles };
  }

  async function seedDirective(
    service: ChatService,
  ): Promise<ChatMessage> {
    return service.postDirective(
      officeChannel.id,
      buildCtx(OWNER_ID, { isOwner: true }),
      { body: "please ack" },
    );
  }

  it("marks the row as acked and emits DirectiveAcknowledged", async () => {
    const { service, acks, events } = buildWithOutstandingDirective();
    const msg = await seedDirective(service);
    await flush();

    const ack = await service.acknowledgeDirective(msg.id, buildCtx(CLERK_ID));
    expect(ack.ackedAt).toBeInstanceOf(Date);
    expect(acks.find((a) => a.userId === CLERK_ID)?.ackedAt).toBeInstanceOf(
      Date,
    );
    await flush();

    const ackedEvt = events.find(
      (e) => e.event === CHAT_EVENTS.DirectiveAcknowledged,
    );
    expect(ackedEvt).toBeDefined();
  });

  it("throws not_found when message is not a directive", async () => {
    const { service } = buildWithOutstandingDirective();
    // Plain (non-directive) message:
    const plain = await service.postMessage(
      officeChannel.id,
      buildCtx(CLERK_ID),
      { body: "hi" },
    );
    await expect(
      service.acknowledgeDirective(plain.id, buildCtx(CLERK_ID)),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("throws forbidden when the caller was never required to ack", async () => {
    const { service } = buildWithOutstandingDirective();
    const msg = await seedDirective(service);
    await expect(
      service.acknowledgeDirective(msg.id, buildCtx(MINISTER_ID)),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("ChatService.listPendingDirectives", () => {
  const officeChannel = makeChannel({ id: "c-office", nodeId: OFFICE_NODE_ID });

  it("returns all un-acked directives for the caller", async () => {
    const handles = createInMemoryRepo(baseSeed([officeChannel]));
    const { bus } = createRecordingBus();
    const service = new ChatService({ repo: handles.repo, bus });

    await service.postDirective(
      officeChannel.id,
      buildCtx(OWNER_ID, { isOwner: true }),
      { body: "one" },
    );
    await service.postDirective(
      officeChannel.id,
      buildCtx(OWNER_ID, { isOwner: true }),
      { body: "two" },
    );

    const pending = await service.listPendingDirectives(buildCtx(CLERK_ID));
    expect(pending.map((p) => p.message.body).sort()).toEqual(["one", "two"]);
  });
});

describe("ChatService.listMessages", () => {
  const openChannel = makeChannel({ id: "c-open", nodeId: null });

  function build(opts: { withMessages?: boolean } = {}) {
    const seedMessages: ChatMessage[] = opts.withMessages
      ? Array.from({ length: 5 }, (_, i) => ({
          id: `seed-${i}`,
          channelId: openChannel.id,
          authorId: MINISTER_ID,
          body: `hello ${i}`,
          metadata: {},
          isDirective: false,
          directiveFromNode: null,
          createdAt: new Date(2026, 0, 1, 12, i),
          editedAt: null,
          deletedAt: null,
        }))
      : [];
    const { repo } = createInMemoryRepo({
      ...baseSeed([openChannel]),
      messages: seedMessages,
    });
    const { bus } = createRecordingBus();
    return new ChatService({ repo, bus });
  }

  it("returns chronologically ordered messages for a readable channel", async () => {
    const msgs = await build({ withMessages: true }).listMessages(
      openChannel.id,
      buildCtx(MINISTER_ID),
    );
    expect(msgs.map((m) => m.body)).toEqual([
      "hello 0",
      "hello 1",
      "hello 2",
      "hello 3",
      "hello 4",
    ]);
  });

  it("rejects with not_found for a missing channel", async () => {
    const service = build();
    await expect(
      service.listMessages("c-ghost", buildCtx(MINISTER_ID)),
    ).rejects.toBeInstanceOf(ChatAccessError);
  });
});

describe("ChatService.canReadChannel", () => {
  const openChannel = makeChannel({ id: "c-open", nodeId: null });
  const officeChannel = makeChannel({ id: "c-office", nodeId: OFFICE_NODE_ID });

  function build() {
    const { repo } = createInMemoryRepo(baseSeed([openChannel, officeChannel]));
    const { bus } = createRecordingBus();
    return new ChatService({ repo, bus });
  }

  it("always true for the Sovereign", () => {
    expect(
      build().canReadChannel(
        officeChannel,
        buildCtx(OWNER_ID, { isOwner: true }),
      ),
    ).toBe(true);
  });

  it("false without chat.read", () => {
    expect(build().canReadChannel(openChannel, buildCtx(OUTSIDER_ID))).toBe(
      false,
    );
  });

  it("unbound channel readable by anyone with chat.read", () => {
    expect(build().canReadChannel(openChannel, buildCtx(MINISTER_ID))).toBe(
      true,
    );
  });

  it("node-bound channel: direct member → true", () => {
    expect(build().canReadChannel(officeChannel, buildCtx(CLERK_ID))).toBe(
      true,
    );
  });

  it("node-bound channel: ancestor member → true (power flows down the Vertical)", () => {
    expect(build().canReadChannel(officeChannel, buildCtx(MINISTER_ID))).toBe(
      true,
    );
  });

  it("node-bound channel: unrelated user → false even with chat.read", () => {
    expect(
      build().canReadChannel(
        officeChannel,
        buildCtx(OUTSIDER_ID, {
          extraPermissions: [ChatPermissions.Read],
        }),
      ),
    ).toBe(false);
  });
});
