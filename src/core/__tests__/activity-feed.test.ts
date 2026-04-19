/**
 * Unit tests for `ActivityFeedService` and the canonical Event Bus
 * fan-out subscribers in `src/core/activity-feed.ts`.
 *
 * Все тесты бегут поверх in-memory репозитория и `InMemoryEventBus`.
 * Персистентный слой (`activity-feed-prisma.ts`) покрывается
 * отдельным интеграционным тестом.
 */

import { describe, expect, it } from "vitest";
import { ACTIVITY_EVENTS } from "../activity-events";
import {
  ACTIVITY_SUBSCRIBED_EVENTS,
  ActivityFeedService,
  subscribeActivityFeed,
  type ActivityLog,
  type ActivityRepository,
  type ActivityViewerContext,
  type RecordActivityInput,
} from "../activity-feed";
import { InMemoryEventBus, KernelEvents } from "../event-bus";

// ------------------------------------------------------------
// In-memory repo
// ------------------------------------------------------------

class MemRepo implements ActivityRepository {
  rows: ActivityLog[] = [];
  private seq = 0;
  insertShouldFail = false;

  async insert(input: RecordActivityInput): Promise<ActivityLog> {
    if (this.insertShouldFail) {
      throw new Error("repo down");
    }
    const row: ActivityLog = {
      id: `log_${++this.seq}`,
      stateId: input.stateId,
      event: input.event,
      category: input.category,
      titleKey: input.titleKey,
      titleParams: input.titleParams ?? {},
      actorId: input.actorId ?? null,
      nodeId: input.nodeId ?? null,
      visibility: input.visibility ?? "public",
      audienceUserIds: input.audienceUserIds ?? [],
      metadata: input.metadata ?? {},
      createdAt: new Date(1_700_000_000_000 + this.seq * 1000),
    };
    this.rows.push(row);
    return row;
  }

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
    let rows = this.rows.filter((r) => r.stateId === stateId);
    if (opts.category) rows = rows.filter((r) => r.category === opts.category);
    if (opts.event) rows = rows.filter((r) => r.event === opts.event);
    if (opts.actorId) rows = rows.filter((r) => r.actorId === opts.actorId);
    if (opts.before)
      rows = rows.filter((r) => r.createdAt.getTime() < opts.before!.getTime());
    // newest-first, like a real index-backed query.
    rows = rows.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows.slice(0, opts.limit);
  }
}

function viewer(overrides: Partial<ActivityViewerContext> = {}): ActivityViewerContext {
  return {
    userId: "u_alice",
    stateId: "state_alpha",
    isOwner: false,
    scopeNodeIds: new Set(),
    ...overrides,
  };
}

// ------------------------------------------------------------
// record() + visibility filter
// ------------------------------------------------------------

describe("ActivityFeedService.record", () => {
  it("persists a row with sensible defaults", async () => {
    const repo = new MemRepo();
    const svc = new ActivityFeedService({ repo });
    const row = await svc.record({
      stateId: "state_alpha",
      event: "core.wallet.transaction.created",
      category: "wallet",
      titleKey: "pulse.event.wallet.transfer",
    });
    expect(row).not.toBeNull();
    expect(row!.visibility).toBe("public");
    expect(row!.titleParams).toEqual({});
    expect(row!.metadata).toEqual({});
    expect(repo.rows).toHaveLength(1);
  });

  it("emits core.activity.recorded on success when bus is wired", async () => {
    const repo = new MemRepo();
    const bus = new InMemoryEventBus();
    const svc = new ActivityFeedService({ repo, bus });

    const seen: Array<{ entry: ActivityLog }> = [];
    bus.on<{ entry: ActivityLog }>(ACTIVITY_EVENTS.Recorded, (p) => {
      seen.push(p);
    });

    await svc.record({
      stateId: "state_alpha",
      event: "e",
      category: "wallet",
      titleKey: "k",
    });

    // bus.emit is kicked off non-awaited; give microtasks a beat.
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.entry.stateId).toBe("state_alpha");
  });

  it("returns null when the repo throws (best-effort semantics)", async () => {
    const repo = new MemRepo();
    repo.insertShouldFail = true;
    const svc = new ActivityFeedService({ repo });
    const out = await svc.record({
      stateId: "state_alpha",
      event: "e",
      category: "wallet",
      titleKey: "k",
    });
    expect(out).toBeNull();
  });
});

// ------------------------------------------------------------
// listForViewer visibility filter
// ------------------------------------------------------------

describe("ActivityFeedService.listForViewer", () => {
  it("hides sovereign rows from ordinary viewers", async () => {
    const repo = new MemRepo();
    const svc = new ActivityFeedService({ repo });
    await svc.record({
      stateId: "state_alpha",
      event: "e1",
      category: "state",
      titleKey: "k",
      visibility: "sovereign",
    });
    await svc.record({
      stateId: "state_alpha",
      event: "e2",
      category: "state",
      titleKey: "k",
      visibility: "public",
    });
    const rows = await svc.listForViewer(viewer());
    expect(rows.map((r) => r.event)).toEqual(["e2"]);
  });

  it("the Sovereign sees everything in his state", async () => {
    const repo = new MemRepo();
    const svc = new ActivityFeedService({ repo });
    await svc.record({
      stateId: "state_alpha",
      event: "e1",
      category: "state",
      titleKey: "k",
      visibility: "sovereign",
    });
    const rows = await svc.listForViewer(viewer({ isOwner: true }));
    expect(rows).toHaveLength(1);
  });

  it("node-visibility is granted when viewer is in scope", async () => {
    const repo = new MemRepo();
    const svc = new ActivityFeedService({ repo });
    await svc.record({
      stateId: "state_alpha",
      event: "chat.channel",
      category: "chat",
      titleKey: "k",
      visibility: "node",
      nodeId: "node_parliament",
    });
    const own = await svc.listForViewer(viewer());
    const scoped = await svc.listForViewer(
      viewer({ scopeNodeIds: new Set(["node_parliament"]) }),
    );
    expect(own).toHaveLength(0);
    expect(scoped).toHaveLength(1);
  });

  it("audience-visibility needs explicit userId", async () => {
    const repo = new MemRepo();
    const svc = new ActivityFeedService({ repo });
    await svc.record({
      stateId: "state_alpha",
      event: "wallet.tx",
      category: "wallet",
      titleKey: "k",
      visibility: "audience",
      audienceUserIds: ["u_alice"],
    });
    expect(await svc.listForViewer(viewer({ userId: "u_bob" }))).toHaveLength(0);
    expect(await svc.listForViewer(viewer({ userId: "u_alice" }))).toHaveLength(1);
  });

  it("the actor always sees his own action", async () => {
    const repo = new MemRepo();
    const svc = new ActivityFeedService({ repo });
    await svc.record({
      stateId: "state_alpha",
      event: "wallet.tx",
      category: "wallet",
      titleKey: "k",
      actorId: "u_alice",
      visibility: "sovereign",
    });
    expect(await svc.listForViewer(viewer({ userId: "u_alice" }))).toHaveLength(1);
  });

  it("foreign-state rows are invisible even to the Sovereign", async () => {
    const repo = new MemRepo();
    const svc = new ActivityFeedService({ repo });
    await svc.record({
      stateId: "state_beta",
      event: "e",
      category: "state",
      titleKey: "k",
      visibility: "public",
    });
    const rows = await svc.listForViewer(viewer({ isOwner: true }));
    expect(rows).toHaveLength(0);
  });

  it("clamps insane limits and coerces non-finite values", async () => {
    const repo = new MemRepo();
    const svc = new ActivityFeedService({ repo });
    for (let i = 0; i < 5; i++) {
      await svc.record({
        stateId: "state_alpha",
        event: `e${i}`,
        category: "state",
        titleKey: "k",
      });
    }
    expect(await svc.listForViewer(viewer(), { limit: -5 })).toHaveLength(5);
    expect(await svc.listForViewer(viewer(), { limit: 9999 })).toHaveLength(5);
    expect(await svc.listForViewer(viewer(), { limit: Number.NaN })).toHaveLength(5);
  });

  it("respects explicit category / event / actor / before filters", async () => {
    const repo = new MemRepo();
    const svc = new ActivityFeedService({ repo });
    await svc.record({
      stateId: "state_alpha",
      event: "a",
      category: "wallet",
      titleKey: "k",
      actorId: "u_a",
    });
    await svc.record({
      stateId: "state_alpha",
      event: "b",
      category: "chat",
      titleKey: "k",
      actorId: "u_b",
    });
    const onlyChat = await svc.listForViewer(viewer(), { category: "chat" });
    expect(onlyChat.map((r) => r.event)).toEqual(["b"]);
    const onlyA = await svc.listForViewer(viewer(), {
      event: "a",
      actorId: "u_a",
    });
    expect(onlyA.map((r) => r.event)).toEqual(["a"]);
    const before = await svc.listForViewer(viewer(), { before: new Date(0) });
    expect(before).toHaveLength(0);
  });

  it("isVisibleTo is exposed for SSE reuse", async () => {
    const repo = new MemRepo();
    const svc = new ActivityFeedService({ repo });
    const row = await svc.record({
      stateId: "state_alpha",
      event: "e",
      category: "state",
      titleKey: "k",
      visibility: "sovereign",
    });
    expect(svc.isVisibleTo(row!, viewer())).toBe(false);
    expect(svc.isVisibleTo(row!, viewer({ isOwner: true }))).toBe(true);
  });
});

// ------------------------------------------------------------
// subscribeActivityFeed — canonical module events ➜ Pulse rows
// ------------------------------------------------------------

describe("subscribeActivityFeed", () => {
  it("wires all canonical events and teardown is idempotent", async () => {
    const bus = new InMemoryEventBus();
    const repo = new MemRepo();
    const svc = new ActivityFeedService({ repo });
    const off = subscribeActivityFeed(bus, svc);

    // 1. Wallet transfer (completed) → audience row.
    await bus.emit(ACTIVITY_SUBSCRIBED_EVENTS.WalletTx, {
      stateId: "state_alpha",
      transaction: {
        id: "tx1",
        fromWalletId: "w1",
        toWalletId: "w2",
        kind: "transfer",
        status: "completed",
        amount: 5,
        currency: "GOLD",
        initiatedById: "u_alice",
      },
      recipientUserIds: ["u_bob"],
    });

    // 2. Treasury allocation (covers a second switch branch).
    await bus.emit(ACTIVITY_SUBSCRIBED_EVENTS.WalletTx, {
      stateId: "state_alpha",
      transaction: {
        id: "tx2",
        fromWalletId: "w3",
        toWalletId: "w4",
        kind: "treasury_allocation",
        status: "completed",
        amount: 10,
        currency: "GOLD",
        initiatedById: "u_alice",
      },
      recipientUserIds: [],
    });

    // 3. Mint / burn.
    await bus.emit(ACTIVITY_SUBSCRIBED_EVENTS.WalletTx, {
      stateId: "state_alpha",
      transaction: {
        id: "tx3",
        fromWalletId: null,
        toWalletId: "w4",
        kind: "mint",
        status: "completed",
        amount: 50,
        currency: "GOLD",
        initiatedById: "u_alice",
      },
      recipientUserIds: [],
    });
    await bus.emit(ACTIVITY_SUBSCRIBED_EVENTS.WalletTx, {
      stateId: "state_alpha",
      transaction: {
        id: "tx4",
        fromWalletId: "w4",
        toWalletId: null,
        kind: "burn",
        status: "completed",
        amount: 3,
        currency: "GOLD",
        initiatedById: "u_alice",
      },
      recipientUserIds: [],
    });

    // 4. Non-completed wallet tx → dropped.
    await bus.emit(ACTIVITY_SUBSCRIBED_EVENTS.WalletTx, {
      stateId: "state_alpha",
      transaction: {
        id: "tx5",
        fromWalletId: "w1",
        toWalletId: "w2",
        kind: "transfer",
        status: "pending",
        amount: 5,
        currency: "GOLD",
        initiatedById: "u_alice",
      },
      recipientUserIds: [],
    });

    // 5. Chat channel created.
    await bus.emit(ACTIVITY_SUBSCRIBED_EVENTS.ChatChannelCreated, {
      stateId: "state_alpha",
      channelId: "ch_1",
      nodeId: null,
    });
    await bus.emit(ACTIVITY_SUBSCRIBED_EVENTS.ChatChannelCreated, {
      stateId: "state_alpha",
      channelId: "ch_2",
      nodeId: "node_a",
    });

    // 6. Chat message — only directive version logs.
    await bus.emit(ACTIVITY_SUBSCRIBED_EVENTS.ChatMessageCreated, {
      stateId: "state_alpha",
      channelId: "ch_1",
      nodeId: "node_a",
      message: {
        id: "m1",
        authorId: "u_alice",
        body: "y".repeat(200),
        isDirective: true,
        directiveFromNode: "node_root",
      },
      recipientUserIds: ["u_bob"],
    });
    await bus.emit(ACTIVITY_SUBSCRIBED_EVENTS.ChatMessageCreated, {
      stateId: "state_alpha",
      channelId: "ch_1",
      nodeId: "node_a",
      message: {
        id: "m2",
        authorId: "u_alice",
        body: "hi",
        isDirective: false,
        directiveFromNode: null,
      },
      recipientUserIds: [],
    });

    // 7. Governance.
    await bus.emit(ACTIVITY_SUBSCRIBED_EVENTS.ProposalCreated, {
      stateId: "state_alpha",
      proposalId: "p1",
      createdById: "u_alice",
      targetConfigKey: "transactionTaxRate",
    });
    await bus.emit(ACTIVITY_SUBSCRIBED_EVENTS.ProposalClosed, {
      stateId: "state_alpha",
      proposalId: "p1",
      status: "executed",
    });
    await bus.emit(ACTIVITY_SUBSCRIBED_EVENTS.ProposalExecuted, {
      stateId: "state_alpha",
      proposalId: "p1",
      appliedBy: "u_alice",
      key: "transactionTaxRate",
      value: 0.05,
    });
    await bus.emit(ACTIVITY_SUBSCRIBED_EVENTS.ProposalExecuted, {
      stateId: "state_alpha",
      proposalId: "p2",
      appliedBy: "u_alice",
      key: "currencyDisplayName",
      value: "KRN",
    });
    await bus.emit(ACTIVITY_SUBSCRIBED_EVENTS.ProposalExecuted, {
      stateId: "state_alpha",
      proposalId: "p3",
      appliedBy: "u_alice",
      key: "governanceRules",
      value: { circular: null as unknown },
    });
    await bus.emit(ACTIVITY_SUBSCRIBED_EVENTS.ProposalVetoed, {
      stateId: "state_alpha",
      proposalId: "p1",
      vetoedById: "u_alice",
      reason: null,
    });

    // 8. State settings.
    await bus.emit(ACTIVITY_SUBSCRIBED_EVENTS.StateSettingsUpdated, {
      stateId: "state_alpha",
      updatedById: "u_alice",
      after: { transactionTaxRate: 0.05 },
    });

    // 9. Kernel events.
    await bus.emit(KernelEvents.StateCreated, {
      stateId: "state_alpha",
      actorId: "u_alice",
    });
    await bus.emit(KernelEvents.MembershipGranted, {
      stateId: "state_alpha",
      userId: "u_bob",
      nodeId: "node_a",
      actorId: "u_alice",
    });

    // Let fire-and-forget `void service.record` settle.
    for (let i = 0; i < 5; i++) await Promise.resolve();

    // 4 completed wallet + 2 chat channels + 1 directive + 1 proposal.created
    // + 1 proposal.closed + 3 proposal.executed + 1 proposal.vetoed
    // + 1 state.settings.updated + 1 state.created + 1 membership.granted
    // = 16 rows.
    expect(repo.rows.length).toBe(16);

    // tear down — further events must not reach the service.
    off();
    await bus.emit(ACTIVITY_SUBSCRIBED_EVENTS.ChatChannelCreated, {
      stateId: "state_alpha",
      channelId: "ch_after_off",
      nodeId: null,
    });
    await Promise.resolve();
    expect(repo.rows.length).toBe(16);
  });

  it("null / falsy payloads are ignored without crashing", async () => {
    const bus = new InMemoryEventBus();
    const repo = new MemRepo();
    const svc = new ActivityFeedService({ repo });
    const off = subscribeActivityFeed(bus, svc);

    await bus.emit(ACTIVITY_SUBSCRIBED_EVENTS.WalletTx, null);
    await bus.emit(ACTIVITY_SUBSCRIBED_EVENTS.ChatChannelCreated, null);
    await bus.emit(ACTIVITY_SUBSCRIBED_EVENTS.ChatMessageCreated, null);
    await bus.emit(ACTIVITY_SUBSCRIBED_EVENTS.ProposalCreated, null);
    await bus.emit(ACTIVITY_SUBSCRIBED_EVENTS.ProposalClosed, null);
    await bus.emit(ACTIVITY_SUBSCRIBED_EVENTS.ProposalExecuted, null);
    await bus.emit(ACTIVITY_SUBSCRIBED_EVENTS.ProposalVetoed, null);
    await bus.emit(ACTIVITY_SUBSCRIBED_EVENTS.StateSettingsUpdated, null);
    await bus.emit(KernelEvents.StateCreated, null);
    await bus.emit(KernelEvents.MembershipGranted, null);

    await Promise.resolve();
    expect(repo.rows).toHaveLength(0);
    off();
  });
});
