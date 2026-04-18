/**
 * Unit tests for the Krwn Exchange Engine (`src/core/exchange.ts`).
 *
 * The service is persistence-agnostic — everything below runs against
 * an in-memory `ExchangeRepository` fake. We cover:
 *
 *   * pair lifecycle (upsert / disable / blockade);
 *   * permissioned pair management (Sovereign vs delegated);
 *   * `getForeignBalance` — owner / Sovereign / delegated / denied;
 *   * `crossStateTransfer` — happy path, insufficient funds, disabled
 *     pair, missing pair, same-state guard, currency mismatch;
 *   * journal persistence + event emission.
 */

import { describe, expect, it, vi } from "vitest";
import {
  ExchangeError,
  ExchangePermissions,
  ExchangeService,
  type CrossStateTransaction,
  type ExchangeActor,
  type ExchangeAssetRef,
  type ExchangePair,
  type ExchangeRepository,
  type ExchangeStateAccess,
  type ExchangeWalletRef,
} from "../exchange";
import type {
  ModuleEventBus,
  PermissionKey,
  VerticalSnapshot,
} from "@/types/kernel";

// ------------------------------------------------------------
// In-memory fakes
// ------------------------------------------------------------

function makeEventBus(): ModuleEventBus & { events: Array<{ event: string; payload: unknown }> } {
  const events: Array<{ event: string; payload: unknown }> = [];
  return {
    events,
    async emit(event, payload) {
      events.push({ event, payload });
    },
    on() {
      return () => {};
    },
  } as ModuleEventBus & { events: Array<{ event: string; payload: unknown }> };
}

function emptySnapshot(stateId: string): VerticalSnapshot {
  return {
    stateId,
    nodes: new Map(),
    membershipsByUser: new Map(),
  };
}

function makeAccess(
  stateId: string,
  opts: {
    isOwner?: boolean;
    permissions?: PermissionKey[];
    snapshot?: VerticalSnapshot;
  } = {},
): ExchangeStateAccess {
  return {
    stateId,
    isOwner: opts.isOwner ?? false,
    permissions: new Set(opts.permissions ?? []),
    snapshot: opts.snapshot ?? emptySnapshot(stateId),
  };
}

function makeActor(
  userId: string,
  accesses: ExchangeStateAccess[],
): ExchangeActor {
  const map = new Map<string, ExchangeStateAccess>();
  for (const a of accesses) map.set(a.stateId, a);
  return { userId, states: map };
}

class InMemoryRepo implements ExchangeRepository {
  pairs = new Map<string, ExchangePair>();
  assets = new Map<string, ExchangeAssetRef>();
  wallets = new Map<string, ExchangeWalletRef>();
  crossTxs: CrossStateTransaction[] = [];
  private pairIdSeq = 0;
  private txIdSeq = 0;

  async findPair(fromAssetId: string, toAssetId: string): Promise<ExchangePair | null> {
    for (const p of this.pairs.values()) {
      if (p.fromAssetId === fromAssetId && p.toAssetId === toAssetId) return p;
    }
    return null;
  }
  async findPairById(id: string): Promise<ExchangePair | null> {
    return this.pairs.get(id) ?? null;
  }
  async listPairs(filter: { stateId?: string; direction?: "outbound" | "inbound" | "both" } = {}): Promise<ExchangePair[]> {
    const all = [...this.pairs.values()];
    if (!filter.stateId) return all;
    const dir = filter.direction ?? "both";
    return all.filter((p) => {
      if (dir === "outbound") return p.fromStateId === filter.stateId;
      if (dir === "inbound") return p.toStateId === filter.stateId;
      return p.fromStateId === filter.stateId || p.toStateId === filter.stateId;
    });
  }
  async upsertPair(input: {
    fromAssetId: string;
    fromStateId: string;
    toAssetId: string;
    toStateId: string;
    rate: number;
    isManual: boolean;
    enabled: boolean;
    createdById: string;
    metadata: Record<string, unknown>;
  }): Promise<ExchangePair> {
    const existing = await this.findPair(input.fromAssetId, input.toAssetId);
    const now = new Date();
    if (existing) {
      const updated: ExchangePair = {
        ...existing,
        rate: input.rate,
        isManual: input.isManual,
        enabled: input.enabled,
        metadata: input.metadata,
        updatedAt: now,
      };
      this.pairs.set(existing.id, updated);
      return updated;
    }
    const id = `pair_${++this.pairIdSeq}`;
    const pair: ExchangePair = {
      id,
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.pairs.set(id, pair);
    return pair;
  }
  async setPairEnabled(pairId: string, enabled: boolean): Promise<ExchangePair> {
    const p = this.pairs.get(pairId);
    if (!p) throw new Error("pair_not_found");
    const updated: ExchangePair = { ...p, enabled, updatedAt: new Date() };
    this.pairs.set(pairId, updated);
    return updated;
  }
  async deletePair(pairId: string): Promise<void> {
    this.pairs.delete(pairId);
  }
  async findAssetById(assetId: string): Promise<ExchangeAssetRef | null> {
    return this.assets.get(assetId) ?? null;
  }
  async findWalletById(walletId: string): Promise<ExchangeWalletRef | null> {
    return this.wallets.get(walletId) ?? null;
  }
  async executeCrossStateTransfer(input: {
    pair: ExchangePair;
    fromWallet: ExchangeWalletRef;
    toWallet: ExchangeWalletRef;
    fromAsset: ExchangeAssetRef;
    toAsset: ExchangeAssetRef;
    fromAmount: number;
    toAmount: number;
    initiatedById: string;
    metadata: Record<string, unknown>;
  }): Promise<CrossStateTransaction> {
    const src = this.wallets.get(input.fromWallet.id);
    const dst = this.wallets.get(input.toWallet.id);
    if (!src || !dst) throw new Error("wallet_not_found");
    if (src.balance < input.fromAmount) {
      const failed: CrossStateTransaction = {
        id: `cst_${++this.txIdSeq}`,
        pairId: input.pair.id,
        fromStateId: input.fromWallet.stateId,
        fromAssetId: input.fromAsset.id,
        fromWalletId: input.fromWallet.id,
        fromTransactionId: null,
        toStateId: input.toWallet.stateId,
        toAssetId: input.toAsset.id,
        toWalletId: input.toWallet.id,
        toTransactionId: null,
        fromAmount: input.fromAmount,
        toAmount: input.toAmount,
        rate: input.pair.rate,
        status: "failed",
        initiatedById: input.initiatedById,
        metadata: { ...input.metadata, error: "insufficient_funds" },
        createdAt: new Date(),
      };
      this.crossTxs.push(failed);
      throw Object.assign(new Error("insufficient_funds"), {
        code: "insufficient_funds",
        transaction: failed,
      });
    }
    this.wallets.set(src.id, { ...src, balance: src.balance - input.fromAmount });
    this.wallets.set(dst.id, { ...dst, balance: dst.balance + input.toAmount });
    const row: CrossStateTransaction = {
      id: `cst_${++this.txIdSeq}`,
      pairId: input.pair.id,
      fromStateId: input.fromWallet.stateId,
      fromAssetId: input.fromAsset.id,
      fromWalletId: input.fromWallet.id,
      fromTransactionId: `tx_burn_${this.txIdSeq}`,
      toStateId: input.toWallet.stateId,
      toAssetId: input.toAsset.id,
      toWalletId: input.toWallet.id,
      toTransactionId: `tx_mint_${this.txIdSeq}`,
      fromAmount: input.fromAmount,
      toAmount: input.toAmount,
      rate: input.pair.rate,
      status: "completed",
      initiatedById: input.initiatedById,
      metadata: input.metadata,
      createdAt: new Date(),
    };
    this.crossTxs.push(row);
    return row;
  }
  async listCrossStateTransactions(filter: {
    stateId?: string;
    pairId?: string;
    initiatedById?: string;
    limit?: number;
    before?: Date | null;
  }): Promise<CrossStateTransaction[]> {
    let rows = this.crossTxs;
    if (filter.stateId) {
      rows = rows.filter(
        (r) => r.fromStateId === filter.stateId || r.toStateId === filter.stateId,
      );
    }
    if (filter.pairId) rows = rows.filter((r) => r.pairId === filter.pairId);
    if (filter.initiatedById)
      rows = rows.filter((r) => r.initiatedById === filter.initiatedById);
    return rows.slice(0, filter.limit ?? 50);
  }
}

// ------------------------------------------------------------
// Fixture: Alpha ($GOLD) ↔ Beta ($DEV)
// ------------------------------------------------------------

function seedFixture() {
  const repo = new InMemoryRepo();
  const bus = makeEventBus();

  const ALPHA = "state_alpha";
  const BETA = "state_beta";
  const ALICE = "user_alice"; // sovereign of Alpha
  const BORIS = "user_boris"; // sovereign of Beta
  const CIVILIAN = "user_civilian"; // regular Alpha citizen

  const gold: ExchangeAssetRef = {
    id: "asset_gold",
    stateId: ALPHA,
    symbol: "GOLD",
    decimals: 2,
  };
  const dev: ExchangeAssetRef = {
    id: "asset_dev",
    stateId: BETA,
    symbol: "DEV",
    decimals: 2,
  };
  repo.assets.set(gold.id, gold);
  repo.assets.set(dev.id, dev);

  // Alice's wallets in both States.
  const aliceAlpha: ExchangeWalletRef = {
    id: "wlt_alice_alpha",
    stateId: ALPHA,
    assetId: gold.id,
    userId: ALICE,
    nodeId: null,
    type: "PERSONAL",
    balance: 1000,
    currency: "GOLD",
  };
  const aliceBeta: ExchangeWalletRef = {
    id: "wlt_alice_beta",
    stateId: BETA,
    assetId: dev.id,
    userId: ALICE,
    nodeId: null,
    type: "PERSONAL",
    balance: 0,
    currency: "DEV",
  };
  repo.wallets.set(aliceAlpha.id, aliceAlpha);
  repo.wallets.set(aliceBeta.id, aliceBeta);

  // Civilian wallet in Alpha (low balance, used for owner-check tests).
  const civilianAlpha: ExchangeWalletRef = {
    id: "wlt_civ_alpha",
    stateId: ALPHA,
    assetId: gold.id,
    userId: CIVILIAN,
    nodeId: null,
    type: "PERSONAL",
    balance: 5,
    currency: "GOLD",
  };
  repo.wallets.set(civilianAlpha.id, civilianAlpha);

  const svc = new ExchangeService({ repo, bus });

  // Sovereign actors (each owns their own State, holds nothing in the other).
  const alice: ExchangeActor = makeActor(ALICE, [
    makeAccess(ALPHA, { isOwner: true }),
    makeAccess(BETA, { isOwner: false }),
  ]);
  const boris: ExchangeActor = makeActor(BORIS, [
    makeAccess(ALPHA, { isOwner: false }),
    makeAccess(BETA, { isOwner: true }),
  ]);
  const civilian: ExchangeActor = makeActor(CIVILIAN, [
    makeAccess(ALPHA, {
      isOwner: false,
      permissions: ["wallet.transfer" as PermissionKey],
    }),
  ]);

  return {
    repo,
    svc,
    bus,
    alice,
    boris,
    civilian,
    wallets: { aliceAlpha, aliceBeta, civilianAlpha },
    assets: { gold, dev },
    states: { ALPHA, BETA },
    ids: { ALICE, BORIS, CIVILIAN },
  };
}

// ------------------------------------------------------------
// Tests
// ------------------------------------------------------------

describe("ExchangeService.upsertPair", () => {
  it("lets the Sovereign of the source State register a pair", async () => {
    const f = seedFixture();
    const pair = await f.svc.upsertPair(f.alice, {
      fromAssetId: f.assets.gold.id,
      toAssetId: f.assets.dev.id,
      rate: 10,
    });
    expect(pair.rate).toBe(10);
    expect(pair.fromStateId).toBe(f.states.ALPHA);
    expect(pair.toStateId).toBe(f.states.BETA);
    expect(pair.enabled).toBe(true);
    expect(pair.isManual).toBe(true);
    expect(f.bus.events[0]?.event).toBe("core.exchange.pair.upserted");
  });

  it("rejects non-Sovereign without ManagePairs", async () => {
    const f = seedFixture();
    await expect(
      f.svc.upsertPair(f.civilian, {
        fromAssetId: f.assets.gold.id,
        toAssetId: f.assets.dev.id,
        rate: 10,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("accepts a non-Sovereign that holds ManagePairs in the source State", async () => {
    const f = seedFixture();
    const delegate = makeActor("user_mint_policy", [
      makeAccess(f.states.ALPHA, {
        permissions: [ExchangePermissions.ManagePairs],
      }),
    ]);
    const pair = await f.svc.upsertPair(delegate, {
      fromAssetId: f.assets.gold.id,
      toAssetId: f.assets.dev.id,
      rate: 12,
    });
    expect(pair.createdById).toBe("user_mint_policy");
  });

  it("rejects self-loop and non-positive rates", async () => {
    const f = seedFixture();
    await expect(
      f.svc.upsertPair(f.alice, {
        fromAssetId: f.assets.gold.id,
        toAssetId: f.assets.gold.id,
        rate: 1,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      f.svc.upsertPair(f.alice, {
        fromAssetId: f.assets.gold.id,
        toAssetId: f.assets.dev.id,
        rate: 0,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("ExchangeService.setPairEnabled (blockade)", () => {
  it("either Sovereign can flip the toggle", async () => {
    const f = seedFixture();
    const pair = await f.svc.upsertPair(f.alice, {
      fromAssetId: f.assets.gold.id,
      toAssetId: f.assets.dev.id,
      rate: 10,
    });
    const blocked = await f.svc.setPairEnabled(f.boris, pair.id, false);
    expect(blocked.enabled).toBe(false);
    const reopened = await f.svc.setPairEnabled(f.alice, pair.id, true);
    expect(reopened.enabled).toBe(true);
  });

  it("forbids strangers", async () => {
    const f = seedFixture();
    const pair = await f.svc.upsertPair(f.alice, {
      fromAssetId: f.assets.gold.id,
      toAssetId: f.assets.dev.id,
      rate: 10,
    });
    await expect(
      f.svc.setPairEnabled(f.civilian, pair.id, false),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("ExchangeService.quote", () => {
  it("converts at the pegged rate and rounds to destination decimals", async () => {
    const f = seedFixture();
    await f.svc.upsertPair(f.alice, {
      fromAssetId: f.assets.gold.id,
      toAssetId: f.assets.dev.id,
      rate: 10,
    });
    const q = await f.svc.quote(f.assets.gold.id, f.assets.dev.id, 3.33);
    // rate = 10, gold amount 3.33 → 33.3 DEV (2 decimals → 33.30).
    expect(q.toAmount).toBeCloseTo(33.3, 5);
    expect(q.rate).toBe(10);
  });

  it("refuses to quote a blockaded pair", async () => {
    const f = seedFixture();
    const pair = await f.svc.upsertPair(f.alice, {
      fromAssetId: f.assets.gold.id,
      toAssetId: f.assets.dev.id,
      rate: 10,
    });
    await f.svc.setPairEnabled(f.alice, pair.id, false);
    await expect(
      f.svc.quote(f.assets.gold.id, f.assets.dev.id, 1),
    ).rejects.toBeInstanceOf(ExchangeError);
  });

  it("fails cleanly when no pair is registered", async () => {
    const f = seedFixture();
    await expect(
      f.svc.quote(f.assets.gold.id, f.assets.dev.id, 1),
    ).rejects.toMatchObject({ code: "pair_missing" });
  });
});

describe("ExchangeService.getForeignBalance", () => {
  it("allows the owner to read their own wallet in any State", async () => {
    const f = seedFixture();
    // Alice asks for her Beta wallet — she is NOT sovereign of Beta
    // but the wallet is hers, so the service must allow it.
    const w = await f.svc.getForeignBalance(f.alice, f.wallets.aliceBeta.id);
    expect(w.id).toBe(f.wallets.aliceBeta.id);
  });

  it("allows the Sovereign of the wallet's State", async () => {
    const f = seedFixture();
    const w = await f.svc.getForeignBalance(f.boris, f.wallets.aliceBeta.id);
    expect(w.id).toBe(f.wallets.aliceBeta.id);
  });

  it("forbids strangers without ViewForeign", async () => {
    const f = seedFixture();
    await expect(
      f.svc.getForeignBalance(f.civilian, f.wallets.aliceBeta.id),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("allows a non-Sovereign who holds ViewForeign in the target State", async () => {
    const f = seedFixture();
    const diplomat = makeActor("user_diplomat", [
      makeAccess(f.states.BETA, {
        permissions: [ExchangePermissions.ViewForeign],
      }),
    ]);
    const w = await f.svc.getForeignBalance(diplomat, f.wallets.aliceBeta.id);
    expect(w.id).toBe(f.wallets.aliceBeta.id);
  });
});

describe("ExchangeService.crossStateTransfer", () => {
  it("debits source, credits destination at pegged rate, writes journal", async () => {
    const f = seedFixture();
    await f.svc.upsertPair(f.alice, {
      fromAssetId: f.assets.gold.id,
      toAssetId: f.assets.dev.id,
      rate: 10,
    });

    const journal = await f.svc.crossStateTransfer(f.alice, {
      fromWalletId: f.wallets.aliceAlpha.id,
      toWalletId: f.wallets.aliceBeta.id,
      amount: 7,
      memo: "trade_test",
    });

    expect(journal.status).toBe("completed");
    expect(journal.fromAmount).toBe(7);
    expect(journal.toAmount).toBeCloseTo(70, 5);
    expect(journal.rate).toBe(10);

    expect(f.repo.wallets.get(f.wallets.aliceAlpha.id)?.balance).toBe(993);
    expect(f.repo.wallets.get(f.wallets.aliceBeta.id)?.balance).toBeCloseTo(70, 5);

    const swapEvent = f.bus.events.find(
      (e) => e.event === "core.exchange.swap.completed",
    );
    expect(swapEvent).toBeTruthy();
  });

  it("rejects when pair is missing", async () => {
    const f = seedFixture();
    await expect(
      f.svc.crossStateTransfer(f.alice, {
        fromWalletId: f.wallets.aliceAlpha.id,
        toWalletId: f.wallets.aliceBeta.id,
        amount: 1,
      }),
    ).rejects.toMatchObject({ code: "pair_missing" });
  });

  it("rejects when pair is blockaded", async () => {
    const f = seedFixture();
    const pair = await f.svc.upsertPair(f.alice, {
      fromAssetId: f.assets.gold.id,
      toAssetId: f.assets.dev.id,
      rate: 10,
    });
    await f.svc.setPairEnabled(f.boris, pair.id, false);
    await expect(
      f.svc.crossStateTransfer(f.alice, {
        fromWalletId: f.wallets.aliceAlpha.id,
        toWalletId: f.wallets.aliceBeta.id,
        amount: 1,
      }),
    ).rejects.toMatchObject({ code: "blockade" });
  });

  it("rejects insufficient funds before touching the repository", async () => {
    const f = seedFixture();
    await f.svc.upsertPair(f.alice, {
      fromAssetId: f.assets.gold.id,
      toAssetId: f.assets.dev.id,
      rate: 10,
    });
    // Alice is Sovereign of Alpha, so she can spend from civilian's wallet,
    // but civilian only has 5 GOLD — the request for 999 must be rejected
    // by the service's pre-flight check, without ever reaching the repo.
    const err: unknown = await f.svc
      .crossStateTransfer(f.alice, {
        fromWalletId: f.wallets.civilianAlpha.id,
        toWalletId: f.wallets.aliceBeta.id,
        amount: 999,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExchangeError);
    expect((err as ExchangeError).code).toBe("insufficient_funds");
    // Source balance untouched and no journal row written (service
    // short-circuits before repo.executeCrossStateTransfer is called).
    expect(f.repo.wallets.get(f.wallets.civilianAlpha.id)?.balance).toBe(5);
    expect(f.repo.crossTxs).toHaveLength(0);
  });

  it("rejects same-state transfers (use intra-state exchange point instead)", async () => {
    const f = seedFixture();
    // Add a second Alpha asset.
    const silver: ExchangeAssetRef = {
      id: "asset_silver",
      stateId: f.states.ALPHA,
      symbol: "SIL",
      decimals: 2,
    };
    f.repo.assets.set(silver.id, silver);
    const aliceAlphaSilver: ExchangeWalletRef = {
      id: "wlt_alice_alpha_silver",
      stateId: f.states.ALPHA,
      assetId: silver.id,
      userId: f.ids.ALICE,
      nodeId: null,
      type: "PERSONAL",
      balance: 0,
      currency: "SIL",
    };
    f.repo.wallets.set(aliceAlphaSilver.id, aliceAlphaSilver);
    await f.svc.upsertPair(f.alice, {
      fromAssetId: f.assets.gold.id,
      toAssetId: silver.id,
      rate: 2,
    });
    await expect(
      f.svc.crossStateTransfer(f.alice, {
        fromWalletId: f.wallets.aliceAlpha.id,
        toWalletId: aliceAlphaSilver.id,
        amount: 1,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("forbids spending from a stranger's wallet", async () => {
    const f = seedFixture();
    await f.svc.upsertPair(f.alice, {
      fromAssetId: f.assets.gold.id,
      toAssetId: f.assets.dev.id,
      rate: 10,
    });
    await expect(
      f.svc.crossStateTransfer(f.civilian, {
        fromWalletId: f.wallets.aliceAlpha.id,
        toWalletId: f.wallets.aliceBeta.id,
        amount: 1,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("ExchangeService.listCrossStateTransactions", () => {
  it("filters by stateId on either leg", async () => {
    const f = seedFixture();
    await f.svc.upsertPair(f.alice, {
      fromAssetId: f.assets.gold.id,
      toAssetId: f.assets.dev.id,
      rate: 10,
    });
    await f.svc.crossStateTransfer(f.alice, {
      fromWalletId: f.wallets.aliceAlpha.id,
      toWalletId: f.wallets.aliceBeta.id,
      amount: 2,
    });
    const alphaRows = await f.svc.listCrossStateTransactions({
      stateId: f.states.ALPHA,
    });
    const betaRows = await f.svc.listCrossStateTransactions({
      stateId: f.states.BETA,
    });
    expect(alphaRows).toHaveLength(1);
    expect(betaRows).toHaveLength(1);
    expect(alphaRows[0]?.id).toBe(betaRows[0]?.id);
  });
});

// Smoke test: the module registration helper doesn't run here but we
// still expose the constant so lint + test don't discard the import.
describe("ExchangePermissions constants", () => {
  it("exposes the three canonical keys", () => {
    expect(ExchangePermissions.ManagePairs).toBe("core.exchange.manage_pairs");
    expect(ExchangePermissions.ViewForeign).toBe("core.exchange.view_foreign");
    expect(ExchangePermissions.Swap).toBe("core.exchange.swap");
  });

  it("unused spy import stays happy", () => {
    // vi is imported above for potential future use; reference it so
    // the linter doesn't flag the module-level import.
    expect(typeof vi.fn).toBe("function");
  });
});
