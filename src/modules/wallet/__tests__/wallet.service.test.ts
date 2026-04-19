/**
 * Unit tests for `WalletService.prepareOnChainIntent` — intent-flow branch
 * with an in-memory repository and a mocked chain provider (no RPC).
 */

import { describe, expect, it } from "vitest";
import { Decimal } from "@prisma/client/runtime/library";
import { WalletService, type Wallet, type WalletRepository } from "../service";
import { ChainProviderRegistry } from "../providers/registry";
import type { ChainProvider } from "../providers/types";
import type { ModuleEventBus, PermissionKey } from "@/types/kernel";

const STATE = "st-test";
const ALICE = "u-alice";
const BOB = "u-bob";
const ASSET_ID = "asset-hybrid";
const NOW = new Date("2026-04-19T12:00:00Z");

function baseWallet(partial: Partial<Wallet> & Pick<Wallet, "id" | "type">): Wallet {
  return {
    stateId: STATE,
    userId: null,
    nodeId: null,
    address: `krwn1usr${partial.id}`,
    assetId: ASSET_ID,
    externalAddress: null,
    lastSyncedAt: null,
    lastSyncedBlock: null,
    balance: new Decimal(100),
    currency: "TST",
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  } as Wallet;
}

const aliceWallet = baseWallet({
  id: "w-alice",
  type: "PERSONAL",
  userId: ALICE,
  externalAddress: "0x1111111111111111111111111111111111111111",
});

const bobWallet = baseWallet({
  id: "w-bob",
  type: "PERSONAL",
  userId: BOB,
  externalAddress: "0x2222222222222222222222222222222222222222",
});

const noopBus: ModuleEventBus = {
  emit: async () => {},
  on: () => () => {},
};

function fakeProvider(network: string): ChainProvider {
  return {
    network,
    chainId: 11155111,
    displayName: "Test",
    async readTokenBalance() {
      return {
        raw: 0n,
        formatted: 0,
        blockNumber: 1n,
      };
    },
    buildTransferIntent(args) {
      return {
        chainId: 11155111,
        to: args.contractAddress,
        data: "0xdeadbeef",
        value: "0",
        humanReadable: {
          network,
          asset: args.asset.symbol,
          recipient: args.toAddress,
          amount: args.amountMinor.toString(),
          decimals: args.asset.decimals,
        },
        intentVersion: 1,
      };
    },
    async readTransactionStatus() {
      return {
        hash: "0x0",
        status: "pending",
        confirmations: 0,
        blockNumber: null,
      };
    },
    async readLatestBlock() {
      return 1n;
    },
  };
}

describe("WalletService.prepareOnChainIntent (mock provider)", () => {
  it("persists a pending tx and returns provider-built intent (HYBRID asset)", async () => {
    const net = "testnet-mock";
    const registry = new ChainProviderRegistry();
    registry.register(fakeProvider(net));

    let created: Parameters<WalletRepository["createPendingOnChainTransaction"]>[0] | null =
      null;

    const repo = {
      async findPersonalWallet(stateId: string, userId: string) {
        if (stateId !== STATE) return null;
        if (userId === ALICE) return aliceWallet;
        if (userId === BOB) return bobWallet;
        return null;
      },
      async findTreasuryWallet() {
        return null;
      },
      async findWalletById() {
        return null;
      },
      async listWalletsForUser() {
        return [];
      },
      async listTreasuriesForState() {
        return [];
      },
      async listOnChainTreasuries() {
        return [];
      },
      async findRootTreasury() {
        return null;
      },
      async ensurePrimaryAsset() {
        throw new Error("not used");
      },
      async findAssetById(stateId: string, assetId: string) {
        if (stateId !== STATE || assetId !== ASSET_ID) return null;
        return {
          id: ASSET_ID,
          stateId: STATE,
          symbol: "TST",
          type: "INTERNAL",
          mode: "HYBRID",
          decimals: 6,
          contractAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          network: net,
          chainId: 11155111,
          canMint: true,
          taxRate: 0,
          publicSupply: false,
        };
      },
      async createPersonalWallet() {
        throw new Error("not used");
      },
      async createTreasuryWallet() {
        throw new Error("not used");
      },
      async updateWalletSyncedBalance() {
        throw new Error("not used");
      },
      async setExternalAddress() {
        throw new Error("not used");
      },
      async createPendingOnChainTransaction(
        input: Parameters<WalletRepository["createPendingOnChainTransaction"]>[0],
      ) {
        created = input;
        return {
          id: "tx-pending-1",
          stateId: input.stateId,
          fromWalletId: input.fromWalletId,
          toWalletId: input.toWalletId,
          amount: input.amount,
          kind: "transfer",
          status: "pending",
          assetId: input.assetId,
          currency: input.currency,
          externalTxHash: null,
          externalStatus: "intent_prepared",
          metadata: input.intentPayload as Record<string, unknown>,
          initiatedById: input.initiatedById,
          createdAt: NOW,
        };
      },
      async attachOnChainHash() {
        throw new Error("not used");
      },
      async settleOnChainTransaction() {
        throw new Error("not used");
      },
      async executeTransfer() {
        throw new Error("not used");
      },
      async listTransactionsForWallet() {
        return [];
      },
      async listUserIdsInNodes() {
        return [];
      },
      async walkAncestors() {
        return [];
      },
    } as unknown as WalletRepository;

    const svc = new WalletService({
      repo,
      bus: noopBus,
      providers: registry,
    });

    const ctx = {
      userId: ALICE,
      isOwner: true,
      snapshot: {
        stateId: STATE,
        nodes: new Map(),
        membershipsByUser: new Map(),
      },
      permissions: new Set() as ReadonlySet<PermissionKey>,
    };

    const { transaction, intent } = await svc.prepareOnChainIntent(STATE, ctx, {
      from: { kind: "personal" },
      to: { kind: "user", userId: BOB },
      amount: 12.345678,
      memo: "intent-memo",
    });

    expect(transaction.status).toBe("pending");
    expect(transaction.externalStatus).toBe("intent_prepared");
    expect(created).not.toBeNull();
    const payload = created!.intentPayload as { intent?: unknown };
    expect(payload.intent).toEqual(intent);
    expect(intent.data).toBe("0xdeadbeef");
    expect(intent.to).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(intent.humanReadable.asset).toBe("TST");
  });
});
