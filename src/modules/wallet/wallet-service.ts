/**
 * WalletService — compact, Permission-Engine-aware facade.
 * ------------------------------------------------------------
 * This file is the ergonomic surface you use from route handlers,
 * CLI commands and RSC actions. It offers just two operations:
 *
 *   * `getBalance(walletId)`  — read the current balance of a wallet
 *   * `transfer(from, to, amount)` — move funds between two wallets
 *
 * The rich, snapshot-aware `WalletService` class lives in
 * `./service.ts` — that one supports mint/burn, treasury listing,
 * per-wallet history, etc. This facade delegates to it and adds
 * the `wallet.manage_treasury` gate required by the spec:
 *
 *   "if the source is a TREASURY wallet, the caller must hold
 *    `wallet.manage_treasury` on the owning node (or any ancestor)."
 *
 * The Permissions Engine inherits permissions down the Vertical, so
 * granting `wallet.manage_treasury` on "Минфин" automatically lets
 * every descendant node (if they're also members) manage their own
 * sub-budget.
 */

import { prisma } from "@/lib/prisma";
import { permissionsEngine, type PermissionsEngine } from "@/core/permissions-engine";
import { eventBus } from "@/core/event-bus";
import type {
  PermissionKey,
  VerticalNode,
  VerticalSnapshot,
} from "@/types/kernel";

import { createPrismaWalletRepository } from "./repo";
import {
  DEFAULT_CURRENCY,
  WalletAccessError,
  WalletService as FullWalletService,
  type Wallet,
  type WalletAccessContext,
  type WalletRepository,
  type WalletTransaction,
} from "./service";
import { WalletPermissions } from "./permissions";

// ------------------------------------------------------------
// Public types for the compact API
// ------------------------------------------------------------

export interface BalanceReadout {
  walletId: string;
  address: string;
  type: "PERSONAL" | "TREASURY";
  balance: number;
  currency: string;
  /** `userId` for personal wallets, `nodeId` for treasuries. */
  ownerRef: { kind: "user"; userId: string } | { kind: "node"; nodeId: string };
}

/**
 * Minimal caller identity the service needs in order to check
 * permissions. Build it once per request from your auth context.
 */
export interface ActorContext {
  userId: string;
  stateId: string;
}

export interface TransferOptions {
  currency?: string;
  /**
   * Constrain the transfer to a specific `StateAsset`. When set,
   * BOTH the source and the destination wallets must be bound to
   * this asset, otherwise the service throws `invalid_input`. This
   * is how multi-currency States keep their ledgers from bleeding
   * into each other (you can't accidentally move "DurovCoin" into
   * the "Empire Gold" column by sharing a currency code).
   *
   * When omitted, the repository's currency-code check remains the
   * only guard — matching the legacy single-asset behaviour.
   */
  assetId?: string;
  memo?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Reference to a wallet the facade can resolve. Accepts either:
 *   * `{ walletId }`                          — direct pointer;
 *   * `{ stateId, userId, assetId? }`         — that user's
 *     personal wallet for the given asset (or primary if omitted);
 *   * `{ stateId, nodeId, assetId? }`         — that node's
 *     treasury wallet for the given asset (or primary if omitted).
 *
 * The multi-asset overloads allow callers to address wallets by the
 * natural tuple `(owner, asset)` without pre-resolving ids — which
 * is exactly what a Currency Factory with several active assets
 * needs.
 */
export type WalletRef =
  | { walletId: string }
  | { stateId: string; userId: string; assetId?: string | null }
  | { stateId: string; nodeId: string; assetId?: string | null };

// ------------------------------------------------------------
// Construction
// ------------------------------------------------------------

export interface WalletServiceDeps {
  repo?: WalletRepository;
  engine?: PermissionsEngine;
  /** Loads a VerticalSnapshot for a state. Defaults to a Prisma one. */
  loadSnapshot?: (stateId: string) => Promise<VerticalSnapshot>;
  /** Full service for rich ops (mint, list history). Defaults to Prisma wiring. */
  core?: FullWalletService;
}

/**
 * Narrow, caller-facing wallet service.
 *
 * Everything the class needs is injected, so it is fully unit-test
 * friendly — swap `repo`, `engine`, `loadSnapshot` and you can run
 * it with an in-memory store.
 */
export class WalletService {
  private readonly repo: WalletRepository;
  private readonly engine: PermissionsEngine;
  private readonly loadSnapshot: (stateId: string) => Promise<VerticalSnapshot>;
  private readonly core: FullWalletService;

  constructor(deps: WalletServiceDeps = {}) {
    this.repo = deps.repo ?? createPrismaWalletRepository(prisma);
    this.engine = deps.engine ?? permissionsEngine;
    this.loadSnapshot = deps.loadSnapshot ?? defaultLoadSnapshot;
    this.core =
      deps.core ??
      new FullWalletService({
        repo: this.repo,
        bus: eventBus,
        engine: this.engine,
      });
  }

  // --------------------------------------------------------
  // getBalance
  // --------------------------------------------------------

  /**
   * Returns the current balance of a wallet.
   *
   * Access rules:
   *   * Personal wallet → only the owner (or the Sovereign) may read.
   *     This also covers the `wallet.view_own` implicit grant.
   *   * Treasury wallet → requires `wallet.view_treasury` (or
   *     `wallet.manage_treasury`) plus membership in the node or any
   *     of its ancestors. Sovereign bypasses.
   *
   * Pass `{ actor: null }` only for internal, already-trusted calls
   * (background jobs, tests). In that case no permission check runs.
   */
  async getBalance(
    ref: string | WalletRef,
    opts: { actor?: ActorContext | null } = {},
  ): Promise<BalanceReadout> {
    const wallet = await this.resolveWallet(ref);
    if (!wallet) {
      throw new WalletAccessError(
        "Wallet not found for the given reference.",
        "not_found",
      );
    }

    if (opts.actor !== null) {
      const actor = opts.actor;
      if (!actor) {
        throw new WalletAccessError(
          "Actor context is required to read a wallet balance.",
          "forbidden",
        );
      }
      if (actor.stateId !== wallet.stateId) {
        throw new WalletAccessError(
          "Wallet belongs to a different State.",
          "forbidden",
        );
      }
      const access = await this.buildAccess(actor);
      await this.assertCanReadWallet(wallet, access);
    }

    return toBalanceReadout(wallet);
  }

  /**
   * Convenience: the actor's own personal wallet for a given asset.
   * If `assetId` is omitted, defaults to the State's primary asset.
   * Equivalent to `getBalance({ stateId, userId, assetId }, { actor })`.
   */
  async getOwnBalance(
    actor: ActorContext,
    opts: { assetId?: string | null } = {},
  ): Promise<BalanceReadout> {
    return this.getBalance(
      { stateId: actor.stateId, userId: actor.userId, assetId: opts.assetId ?? null },
      { actor },
    );
  }

  // --------------------------------------------------------
  // transfer
  // --------------------------------------------------------

  /**
   * Moves `amount` units between two wallets referenced by id.
   *
   * Checks (in order):
   *   1. Both wallets exist and belong to the actor's State.
   *   2. Actor has `wallet.transfer`.
   *   3. If source is PERSONAL — actor must own it (Sovereign bypass).
   *   4. If source is TREASURY — actor must hold
   *      `wallet.manage_treasury` AND be a member of the node or
   *      any ancestor (Sovereign bypasses both).
   *   5. Amount is positive; source has enough funds; currencies match.
   *
   * The actual debit/credit runs atomically inside the repository's
   * `$transaction` — a failing balance check rolls everything back
   * and persists a `failed` Transaction row for audit.
   */
  async transfer(
    from: string | WalletRef,
    to: string | WalletRef,
    amount: number,
    actor: ActorContext,
    opts: TransferOptions = {},
  ): Promise<WalletTransaction> {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new WalletAccessError(
        "Amount must be a positive finite number.",
        "invalid_input",
      );
    }

    // Asset-aware refs let callers address "user X's DurovCoin
    // wallet" without pre-resolving an id. We thread `opts.assetId`
    // through as the default so both sides land on the same asset.
    const defaultRef = opts.assetId
      ? { assetId: opts.assetId }
      : null;

    const [source, dest] = await Promise.all([
      this.resolveWallet(from, { actor, defaults: defaultRef }),
      this.resolveWallet(to, { actor, defaults: defaultRef }),
    ]);
    if (!source) {
      throw new WalletAccessError("Source wallet not found.", "not_found");
    }
    if (!dest) {
      throw new WalletAccessError("Destination wallet not found.", "not_found");
    }
    if (source.id === dest.id) {
      throw new WalletAccessError(
        "Source and destination wallets must differ.",
        "invalid_input",
      );
    }
    if (source.stateId !== actor.stateId || dest.stateId !== actor.stateId) {
      throw new WalletAccessError(
        "Wallets must belong to the actor's State.",
        "forbidden",
      );
    }

    // If the caller pinned an asset, both wallets MUST be bound to
    // it. This is the strict multi-currency gate promised by
    // `TransferOptions.assetId`.
    if (opts.assetId) {
      if (source.assetId !== opts.assetId) {
        throw new WalletAccessError(
          `Source wallet is not bound to asset "${opts.assetId}".`,
          "invalid_input",
        );
      }
      if (dest.assetId !== opts.assetId) {
        throw new WalletAccessError(
          `Destination wallet is not bound to asset "${opts.assetId}".`,
          "invalid_input",
        );
      }
    } else if (
      source.assetId &&
      dest.assetId &&
      source.assetId !== dest.assetId
    ) {
      // Even without an explicit pin, block cross-asset transfers.
      // The currency-code check below catches same-symbol clashes,
      // but two assets can share a symbol historically — the id is
      // the only authoritative match.
      throw new WalletAccessError(
        "Cross-asset transfer is not allowed.",
        "invalid_input",
      );
    }

    const access = await this.buildAccess(actor);

    // (2) baseline transfer right
    if (!access.isOwner && !hasPerm(access.permissions, WalletPermissions.Transfer)) {
      throw new WalletAccessError(
        `Missing permission "${WalletPermissions.Transfer}".`,
        "forbidden",
      );
    }

    // (3)+(4) spend-side gating
    await this.assertCanSpendFromWallet(source, access);

    // Delegate to the full service so tax / canMint / on-chain
    // guards all run in one place — the facade is just here for
    // ergonomics + permission framing.
    return this.core.transfer(actor.stateId, access, {
      from: { kind: "walletId", walletId: source.id },
      to: { kind: "walletId", walletId: dest.id },
      amount,
      currency: opts.currency,
      memo: opts.memo,
      metadata: opts.metadata,
    });
  }

  // --------------------------------------------------------
  // Convenience: expose the full service for callers that need
  // treasury listing, mint, history, etc. without re-wiring deps.
  // --------------------------------------------------------

  get full(): FullWalletService {
    return this.core;
  }

  // --------------------------------------------------------
  // Internals
  // --------------------------------------------------------

  /**
   * Resolve any `WalletRef` (or a bare `walletId` string) to a
   * concrete Wallet row. Used by both `getBalance` and `transfer`
   * so the caller-facing API is identical across lookups.
   *
   * `opts.defaults` lets `transfer` splice the outer `assetId` onto
   * owner-based refs that didn't pin one themselves.
   */
  private async resolveWallet(
    ref: string | WalletRef,
    opts: {
      actor?: ActorContext;
      defaults?: { assetId?: string } | null;
    } = {},
  ): Promise<Wallet | null> {
    if (typeof ref === "string") {
      return this.repo.findWalletById(ref);
    }
    if ("walletId" in ref) {
      return this.repo.findWalletById(ref.walletId);
    }
    const stateId = ref.stateId ?? opts.actor?.stateId;
    if (!stateId) {
      throw new WalletAccessError(
        "WalletRef requires a stateId (either explicitly or via actor).",
        "invalid_input",
      );
    }
    const assetId =
      ref.assetId !== undefined
        ? ref.assetId
        : opts.defaults?.assetId ?? undefined;
    if ("userId" in ref) {
      return this.repo.findPersonalWallet(stateId, ref.userId, {
        assetId: assetId ?? undefined,
      });
    }
    // nodeId branch
    const wallet = await this.repo.findTreasuryWallet(ref.nodeId);
    if (!wallet) return null;
    if (assetId && wallet.assetId !== assetId) {
      // Treasuries are 1-per-node today, but we still reject the
      // wrong asset explicitly rather than silently returning the
      // primary-asset treasury when the caller asked for another.
      return null;
    }
    return wallet;
  }

  private async buildAccess(actor: ActorContext): Promise<WalletAccessContext> {
    const [snapshot, state] = await Promise.all([
      this.loadSnapshot(actor.stateId),
      prisma.state.findUnique({
        where: { id: actor.stateId },
        select: { ownerId: true },
      }),
    ]);
    if (!state) {
      throw new WalletAccessError("State not found.", "not_found");
    }
    const isOwner = state.ownerId === actor.userId;
    const permissions = this.engine.resolveAll({
      stateId: actor.stateId,
      userId: actor.userId,
      isOwner,
      snapshot,
    });
    return { userId: actor.userId, isOwner, snapshot, permissions };
  }

  private async assertCanReadWallet(
    wallet: Wallet,
    ctx: WalletAccessContext,
  ): Promise<void> {
    if (ctx.isOwner) return;

    if (wallet.type === "PERSONAL") {
      if (wallet.userId !== ctx.userId) {
        throw new WalletAccessError(
          "Cannot read another user's personal wallet.",
          "forbidden",
        );
      }
      return;
    }

    // TREASURY
    if (!wallet.nodeId) {
      throw new WalletAccessError(
        "Treasury wallet is missing its node binding.",
        "invalid_input",
      );
    }
    const hasView =
      hasPerm(ctx.permissions, WalletPermissions.ViewTreasury) ||
      hasPerm(ctx.permissions, WalletPermissions.ManageTreasury);
    if (!hasView) {
      throw new WalletAccessError(
        `Missing permission "${WalletPermissions.ViewTreasury}".`,
        "forbidden",
      );
    }
    const member = this.engine.isMemberOfNodeOrAncestor(
      { userId: ctx.userId, isOwner: ctx.isOwner, snapshot: ctx.snapshot },
      wallet.nodeId,
    );
    if (!member.granted) {
      throw new WalletAccessError(
        "Not a member of this node (or any of its ancestors).",
        "forbidden",
      );
    }
  }

  private async assertCanSpendFromWallet(
    wallet: Wallet,
    ctx: WalletAccessContext,
  ): Promise<void> {
    if (ctx.isOwner) return;

    if (wallet.type === "PERSONAL") {
      if (wallet.userId !== ctx.userId) {
        throw new WalletAccessError(
          "Cannot spend from another user's wallet.",
          "forbidden",
        );
      }
      return;
    }

    // TREASURY — the core rule this task adds.
    if (!wallet.nodeId) {
      throw new WalletAccessError(
        "Treasury wallet is missing its node binding.",
        "invalid_input",
      );
    }
    if (!hasPerm(ctx.permissions, WalletPermissions.ManageTreasury)) {
      throw new WalletAccessError(
        `Missing permission "${WalletPermissions.ManageTreasury}" on this treasury.`,
        "forbidden",
      );
    }
    // `resolveAll` already inherits permissions down the Vertical, so
    // holding `wallet.manage_treasury` on any ancestor is enough. But
    // we ALSO require actual membership in the chain — a freelancer
    // with the permission granted globally still can't drain a node
    // they don't belong to.
    const member = this.engine.isMemberOfNodeOrAncestor(
      { userId: ctx.userId, isOwner: ctx.isOwner, snapshot: ctx.snapshot },
      wallet.nodeId,
    );
    if (!member.granted) {
      throw new WalletAccessError(
        "Not a member of this node (or any of its ancestors).",
        "forbidden",
      );
    }
  }
}

// ------------------------------------------------------------
// Singleton (lazy) — import this in routes to skip wiring.
// ------------------------------------------------------------

let _singleton: WalletService | null = null;

export function walletService(): WalletService {
  if (!_singleton) _singleton = new WalletService();
  return _singleton;
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function hasPerm(
  held: ReadonlySet<PermissionKey>,
  required: PermissionKey,
): boolean {
  if (held.has("*")) return true;
  if (held.has(required)) return true;
  const [domain] = required.split(".");
  if (!domain) return false;
  return held.has(`${domain}.*` as PermissionKey);
}

function toBalanceReadout(w: Wallet): BalanceReadout {
  return {
    walletId: w.id,
    address: w.address,
    type: w.type,
    balance: w.balance,
    currency: w.currency,
    ownerRef:
      w.type === "PERSONAL"
        ? { kind: "user", userId: w.userId ?? "" }
        : { kind: "node", nodeId: w.nodeId ?? "" },
  };
}

async function defaultLoadSnapshot(stateId: string): Promise<VerticalSnapshot> {
  const [nodes, memberships] = await Promise.all([
    prisma.verticalNode.findMany({
      where: { stateId },
      select: {
        id: true,
        stateId: true,
        parentId: true,
        title: true,
        type: true,
        permissions: true,
        order: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.membership.findMany({
      where: { node: { stateId }, status: "active" },
      select: { userId: true, nodeId: true },
    }),
  ]);

  const snapshot: VerticalSnapshot = {
    stateId,
    nodes: new Map<string, VerticalNode>(
      nodes.map((n) => [
        n.id,
        { ...n, permissions: n.permissions as PermissionKey[] },
      ]),
    ),
    membershipsByUser: new Map(),
  };
  for (const m of memberships) {
    let set = snapshot.membershipsByUser.get(m.userId);
    if (!set) {
      set = new Set();
      snapshot.membershipsByUser.set(m.userId, set);
    }
    set.add(m.nodeId);
  }
  return snapshot;
}
