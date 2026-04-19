/**
 * Wallet integration tests: atomic tax splits, Decimal / rounding, parallel transfers.
 * Требуется `TEST_DATABASE_URL` с **выделенной** БД; `beforeAll` делает полный
 * TRUNCATE `public` — не указывайте рабочий инстанс с данными.
 *
 * Прогон: в CI (`GITHUB_ACTIONS=true`) или локально `KRWN_INTEGRATION=1` + URL.
 */

import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Decimal } from "@prisma/client/runtime/library";
import { permissionsEngine } from "@/core/permissions-engine";
import type { ModuleEventBus, PermissionKey } from "@/types/kernel";
import { createPrismaWalletRepository } from "../repo";
import { ledgerDecimal, roundLedgerAmount } from "../money";
import {
  WalletService,
  type WalletAccessContext,
} from "../service";

const url =
  process.env.TEST_DATABASE_URL &&
  (process.env.GITHUB_ACTIONS === "true" ||
    process.env.KRWN_INTEGRATION === "1")
    ? process.env.TEST_DATABASE_URL
    : undefined;

async function wipePublicTables(
  prisma: import("@prisma/client").PrismaClient,
): Promise<void> {
  await prisma.$executeRawUnsafe(`
    DO $wipe$
    DECLARE r RECORD;
    BEGIN
      FOR r IN (
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename <> '_prisma_migrations'
      ) LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
      END LOOP;
    END
    $wipe$;
  `);
}

describe.skipIf(!url)("wallet integration (TEST_DATABASE_URL)", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let prismaB: import("@prisma/client").PrismaClient;

  const noopBus: ModuleEventBus = {
    emit: async () => {},
    on: () => () => {},
  };

  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", url!);
    const g = globalThis as { prisma?: import("@prisma/client").PrismaClient };
    delete g.prisma;
    vi.resetModules();
    prisma = (await import("@/lib/prisma")).prisma;
    const { PrismaClient } = await import("@prisma/client");
    prismaB = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
    await wipePublicTables(prisma);
  });

  afterAll(async () => {
    await wipePublicTables(prisma);
    await prismaB.$disconnect();
    await prisma.$disconnect();
    vi.unstubAllEnvs();
  });

  async function seedTaxScenario() {
    const suffix = randomUUID().slice(0, 8);
    const owner = await prisma.user.create({
      data: {
        handle: `tax-owner-${suffix}`,
        email: `tax-owner-${suffix}@test.local`,
      },
    });
    const alice = await prisma.user.create({
      data: {
        handle: `tax-alice-${suffix}`,
        email: `tax-alice-${suffix}@test.local`,
      },
    });
    const bob = await prisma.user.create({
      data: {
        handle: `tax-bob-${suffix}`,
        email: `tax-bob-${suffix}@test.local`,
      },
    });

    const state = await prisma.state.create({
      data: {
        slug: `st-tax-${suffix}`,
        name: "Taxland",
        ownerId: owner.id,
      },
    });

    const asset = await prisma.stateAsset.create({
      data: {
        stateId: state.id,
        symbol: "KRN",
        name: "Krona",
        type: "INTERNAL",
        mode: "LOCAL",
        decimals: 18,
        isPrimary: true,
        taxRate: 0.05,
        canMint: true,
        publicSupply: false,
      },
    });

    await prisma.stateSettings.create({
      data: {
        stateId: state.id,
        transactionTaxRate: 0.1,
        incomeTaxRate: 0,
      },
    });

    const rootNode = await prisma.verticalNode.create({
      data: {
        stateId: state.id,
        parentId: null,
        title: "Root",
        type: "department",
      },
    });

    const repo = createPrismaWalletRepository(prisma);
    const treasury = await repo.createTreasuryWallet({
      stateId: state.id,
      nodeId: rootNode.id,
      assetId: asset.id,
    });
    await prisma.wallet.update({
      where: { id: treasury.id },
      data: { balance: new Decimal(0) },
    });

    await repo.createPersonalWallet({
      stateId: state.id,
      userId: alice.id,
      assetId: asset.id,
    });
    await repo.createPersonalWallet({
      stateId: state.id,
      userId: bob.id,
      assetId: asset.id,
    });

    const aliceWallet = await prisma.wallet.findFirst({
      where: {
        stateId: state.id,
        userId: alice.id,
        type: "PERSONAL",
        assetId: asset.id,
      },
    });
    const bobWallet = await prisma.wallet.findFirst({
      where: {
        stateId: state.id,
        userId: bob.id,
        type: "PERSONAL",
        assetId: asset.id,
      },
    });
    if (!aliceWallet || !bobWallet) throw new Error("seed: wallets missing");

    await prisma.wallet.update({
      where: { id: aliceWallet.id },
      data: { balance: new Decimal(1000) },
    });

    const ctx: WalletAccessContext = {
      userId: alice.id,
      isOwner: true,
      snapshot: { stateId: state.id, nodes: new Map(), membershipsByUser: new Map() },
      permissions: new Set() as ReadonlySet<PermissionKey>,
    };

    return {
      stateId: state.id,
      alice,
      bob,
      aliceWalletId: aliceWallet.id,
      bobWalletId: bobWallet.id,
      treasuryId: treasury.id,
      assetDecimals: asset.decimals,
      ctx,
    };
  }

  it("routes transaction + asset tax into root treasury in one DB transaction (Decimal)", async () => {
    await wipePublicTables(prisma);
    const s = await seedTaxScenario();

    const svc = new WalletService({
      repo: createPrismaWalletRepository(prisma),
      bus: noopBus,
      engine: permissionsEngine,
    });

    const gross = new Decimal(100);
    const effectiveRate = 0.05 + 0.1;
    const taxExpected = roundLedgerAmount(gross.times(effectiveRate), s.assetDecimals);
    const netToBob = gross.minus(taxExpected);

    await svc.transfer(s.stateId, s.ctx, {
      from: { kind: "personal" },
      to: { kind: "user", userId: s.bob.id },
      amount: gross.toNumber(),
    });

    const [aliceRow, bobRow, treRow] = await Promise.all([
      prisma.wallet.findUniqueOrThrow({ where: { id: s.aliceWalletId } }),
      prisma.wallet.findUniqueOrThrow({ where: { id: s.bobWalletId } }),
      prisma.wallet.findUniqueOrThrow({ where: { id: s.treasuryId } }),
    ]);

    expect(ledgerDecimal(aliceRow.balance).equals(new Decimal(900))).toBe(true);
    expect(ledgerDecimal(bobRow.balance).equals(netToBob)).toBe(true);
    expect(ledgerDecimal(treRow.balance).equals(taxExpected)).toBe(true);

    const taxRows = await prisma.transaction.findMany({
      where: {
        stateId: s.stateId,
        kind: "treasury_allocation",
        status: "completed",
      },
    });
    expect(taxRows).toHaveLength(1);
    expect(ledgerDecimal(taxRows[0]!.amount).equals(taxExpected)).toBe(true);
  });

  it.each([
    {
      label: "long fractional gross, 8 dp asset",
      assetDecimals: 8,
      amount: 123.456789012345,
      transactionTaxRate: 0.0777,
      assetTaxRate: 0,
    },
    {
      label: "combined asset + state rate",
      assetDecimals: 12,
      amount: 888.888888888888,
      transactionTaxRate: 0.01,
      assetTaxRate: 0.025,
    },
    {
      label: "banker rounding edge (half-even)",
      assetDecimals: 2,
      amount: 0.205,
      transactionTaxRate: 0.1,
      assetTaxRate: 0,
    },
  ])(
    "parameterized transfer: $label — net + tax === gross (Decimal)",
    async ({ assetDecimals, amount, transactionTaxRate, assetTaxRate }) => {
      await wipePublicTables(prisma);
      const suffix = randomUUID().slice(0, 8);
      const owner = await prisma.user.create({
        data: { handle: `p-${suffix}`, email: `p-${suffix}@t.local` },
      });
      const bob = await prisma.user.create({
        data: { handle: `p-bob-${suffix}`, email: `p-bob-${suffix}@t.local` },
      });
      const state = await prisma.state.create({
        data: { slug: `st-p-${suffix}`, name: "P", ownerId: owner.id },
      });
      const asset = await prisma.stateAsset.create({
        data: {
          stateId: state.id,
          symbol: "KRN",
          name: "Krona",
          type: "INTERNAL",
          mode: "LOCAL",
          decimals: assetDecimals,
          isPrimary: true,
          taxRate: assetTaxRate,
          canMint: true,
          publicSupply: false,
        },
      });
      await prisma.stateSettings.create({
        data: {
          stateId: state.id,
          transactionTaxRate,
          incomeTaxRate: 0,
        },
      });
      const rootNode = await prisma.verticalNode.create({
        data: {
          stateId: state.id,
          parentId: null,
          title: "Root",
          type: "department",
        },
      });
      const repo = createPrismaWalletRepository(prisma);
      const treasury = await repo.createTreasuryWallet({
        stateId: state.id,
        nodeId: rootNode.id,
        assetId: asset.id,
      });
      await prisma.wallet.update({
        where: { id: treasury.id },
        data: { balance: new Decimal(0) },
      });
      await repo.createPersonalWallet({
        stateId: state.id,
        userId: owner.id,
        assetId: asset.id,
      });
      await repo.createPersonalWallet({
        stateId: state.id,
        userId: bob.id,
        assetId: asset.id,
      });
      const ownerWallet = await prisma.wallet.findFirstOrThrow({
        where: {
          stateId: state.id,
          userId: owner.id,
          type: "PERSONAL",
          assetId: asset.id,
        },
      });
      const bobWallet = await prisma.wallet.findFirstOrThrow({
        where: {
          stateId: state.id,
          userId: bob.id,
          type: "PERSONAL",
          assetId: asset.id,
        },
      });
      await prisma.wallet.update({
        where: { id: ownerWallet.id },
        data: { balance: new Decimal(1_000_000) },
      });

      const gross = ledgerDecimal(amount);
      const effectiveRate = Math.min(1, transactionTaxRate + assetTaxRate);
      const taxExpected = roundLedgerAmount(
        gross.times(effectiveRate),
        assetDecimals,
      );
      const netExpected =
        taxExpected.gt(0) && taxExpected.lt(gross)
          ? gross.minus(taxExpected)
          : gross;

      const svc = new WalletService({
        repo,
        bus: noopBus,
        engine: permissionsEngine,
      });
      const ctx: WalletAccessContext = {
        userId: owner.id,
        isOwner: true,
        snapshot: { stateId: state.id, nodes: new Map(), membershipsByUser: new Map() },
        permissions: new Set() as ReadonlySet<PermissionKey>,
      };

      await svc.transfer(state.id, ctx, {
        from: { kind: "personal" },
        to: { kind: "user", userId: bob.id },
        amount,
      });

      const [srcRow, dstRow, treRow] = await Promise.all([
        prisma.wallet.findUniqueOrThrow({ where: { id: ownerWallet.id } }),
        prisma.wallet.findUniqueOrThrow({ where: { id: bobWallet.id } }),
        prisma.wallet.findUniqueOrThrow({ where: { id: treasury.id } }),
      ]);

      expect(ledgerDecimal(srcRow.balance).toString()).toBe(
        new Decimal(1_000_000).minus(gross).toString(),
      );
      expect(ledgerDecimal(dstRow.balance).toString()).toBe(netExpected.toString());
      if (taxExpected.gt(0) && taxExpected.lt(gross)) {
        expect(ledgerDecimal(treRow.balance).toString()).toBe(taxExpected.toString());
        expect(netExpected.plus(taxExpected).toString()).toBe(gross.toString());
      }
    },
  );

  it.each([
    {
      label: "minimal non-zero tax slice (18 dp ledger)",
      grossStr: "0.000000000000000010",
      taxStr: "0.000000000000000001",
    },
    {
      label: "long fractional tail",
      grossStr: "10.000000000000000333",
      taxStr: "0.000000000000000777",
    },
  ])(
    "repo.executeTransfer: $label — exact Decimal reconciliation",
    async ({ grossStr, taxStr }) => {
      await wipePublicTables(prisma);
      const suffix = randomUUID().slice(0, 8);
      const owner = await prisma.user.create({
        data: { handle: `repo-${suffix}`, email: `repo-${suffix}@t.local` },
      });
      const bob = await prisma.user.create({
        data: { handle: `repo-bob-${suffix}`, email: `repo-bob-${suffix}@t.local` },
      });
      const state = await prisma.state.create({
        data: { slug: `st-repo-${suffix}`, name: "R", ownerId: owner.id },
      });
      const asset = await prisma.stateAsset.create({
        data: {
          stateId: state.id,
          symbol: "KRN",
          name: "Krona",
          type: "INTERNAL",
          mode: "LOCAL",
          decimals: 18,
          isPrimary: true,
          taxRate: 0,
          canMint: true,
          publicSupply: false,
        },
      });
      await prisma.stateSettings.create({
        data: { stateId: state.id, transactionTaxRate: 0, incomeTaxRate: 0 },
      });
      const rootNode = await prisma.verticalNode.create({
        data: {
          stateId: state.id,
          parentId: null,
          title: "Root",
          type: "department",
        },
      });
      const repo = createPrismaWalletRepository(prisma);
      const treasury = await repo.createTreasuryWallet({
        stateId: state.id,
        nodeId: rootNode.id,
        assetId: asset.id,
      });
      await repo.createPersonalWallet({
        stateId: state.id,
        userId: owner.id,
        assetId: asset.id,
      });
      await repo.createPersonalWallet({
        stateId: state.id,
        userId: bob.id,
        assetId: asset.id,
      });
      const ownerWallet = await prisma.wallet.findFirstOrThrow({
        where: {
          stateId: state.id,
          userId: owner.id,
          type: "PERSONAL",
          assetId: asset.id,
        },
      });
      const bobWallet = await prisma.wallet.findFirstOrThrow({
        where: {
          stateId: state.id,
          userId: bob.id,
          type: "PERSONAL",
          assetId: asset.id,
        },
      });

      const gross = new Decimal(grossStr);
      const taxAmt = new Decimal(taxStr);
      expect(taxAmt.gt(0) && taxAmt.lt(gross)).toBe(true);

      await prisma.wallet.update({
        where: { id: ownerWallet.id },
        data: { balance: gross },
      });

      await repo.executeTransfer({
        stateId: state.id,
        fromWalletId: ownerWallet.id,
        toWalletId: bobWallet.id,
        amount: gross,
        currency: "KRN",
        kind: "transfer",
        initiatedById: owner.id,
        metadata: { integration: true },
        tax: { toWalletId: treasury.id, amount: taxAmt },
      });

      const [srcRow, dstRow, treRow] = await Promise.all([
        prisma.wallet.findUniqueOrThrow({ where: { id: ownerWallet.id } }),
        prisma.wallet.findUniqueOrThrow({ where: { id: bobWallet.id } }),
        prisma.wallet.findUniqueOrThrow({ where: { id: treasury.id } }),
      ]);

      expect(ledgerDecimal(srcRow.balance).toString()).toBe("0");
      expect(ledgerDecimal(dstRow.balance).toString()).toBe(
        gross.minus(taxAmt).toString(),
      );
      expect(ledgerDecimal(treRow.balance).toString()).toBe(taxAmt.toString());
      expect(
        ledgerDecimal(dstRow.balance).plus(ledgerDecimal(treRow.balance)).toString(),
      ).toBe(gross.toString());
    },
  );

  async function seedRaceScenario() {
    const suffix = randomUUID().slice(0, 8);
    const owner = await prisma.user.create({
      data: {
        handle: `race-owner-${suffix}`,
        email: `race-owner-${suffix}@test.local`,
      },
    });
    const alice = await prisma.user.create({
      data: {
        handle: `race-alice-${suffix}`,
        email: `race-alice-${suffix}@test.local`,
      },
    });
    const bob = await prisma.user.create({
      data: {
        handle: `race-bob-${suffix}`,
        email: `race-bob-${suffix}@test.local`,
      },
    });

    const state = await prisma.state.create({
      data: {
        slug: `st-race-${suffix}`,
        name: "Raceland",
        ownerId: owner.id,
      },
    });

    const asset = await prisma.stateAsset.create({
      data: {
        stateId: state.id,
        symbol: "KRN",
        name: "Krona",
        type: "INTERNAL",
        mode: "LOCAL",
        decimals: 18,
        isPrimary: true,
        taxRate: 0,
        canMint: true,
        publicSupply: false,
      },
    });

    await prisma.stateSettings.create({
      data: {
        stateId: state.id,
        transactionTaxRate: 0,
        incomeTaxRate: 0,
      },
    });

    const rootNode = await prisma.verticalNode.create({
      data: {
        stateId: state.id,
        parentId: null,
        title: "Root",
        type: "department",
      },
    });

    const repo = createPrismaWalletRepository(prisma);
    await repo.createTreasuryWallet({
      stateId: state.id,
      nodeId: rootNode.id,
      assetId: asset.id,
    });

    await repo.createPersonalWallet({
      stateId: state.id,
      userId: alice.id,
      assetId: asset.id,
    });
    await repo.createPersonalWallet({
      stateId: state.id,
      userId: bob.id,
      assetId: asset.id,
    });

    const aliceWallet = await prisma.wallet.findFirst({
      where: {
        stateId: state.id,
        userId: alice.id,
        type: "PERSONAL",
        assetId: asset.id,
      },
    });
    if (!aliceWallet) throw new Error("seed: alice wallet missing");

    await prisma.wallet.update({
      where: { id: aliceWallet.id },
      data: { balance: new Decimal(100) },
    });

    const ctx: WalletAccessContext = {
      userId: alice.id,
      isOwner: true,
      snapshot: { stateId: state.id, nodes: new Map(), membershipsByUser: new Map() },
      permissions: new Set() as ReadonlySet<PermissionKey>,
    };

    return {
      stateId: state.id,
      bobId: bob.id,
      aliceWalletId: aliceWallet.id,
      ctx,
    };
  }

  /**
   * Ожидаемое поведение: списание атомарно (`updateMany` с `balance >= gross`),
   * поэтому при двух параллельных debit по 60 с баланса 100 успевает только одна
   * операция; вторая — `insufficient_funds`; баланс не уходит в минус.
   */
  it("parallel transfers (same Prisma pool): one wins, one insufficient_funds", async () => {
    await wipePublicTables(prisma);
    const s = await seedRaceScenario();

    const svc = new WalletService({
      repo: createPrismaWalletRepository(prisma),
      bus: noopBus,
      engine: permissionsEngine,
    });

    const transfer = () =>
      svc.transfer(s.stateId, s.ctx, {
        from: { kind: "personal" },
        to: { kind: "user", userId: s.bobId },
        amount: 60,
      });

    const results = await Promise.allSettled([transfer(), transfer()]);

    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter((r) => r.status === "rejected").length;
    expect(fulfilled).toBe(1);
    expect(rejected).toBe(1);

    const rej = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    const code = (rej.reason as { code?: string })?.code;
    const message = (rej.reason as { message?: string })?.message;
    expect(code === "insufficient_funds" || message === "insufficient_funds").toBe(
      true,
    );

    const aliceAfter = await prisma.wallet.findUniqueOrThrow({
      where: { id: s.aliceWalletId },
    });
    expect(ledgerDecimal(aliceAfter.balance).equals(new Decimal(40))).toBe(true);
  });

  it("parallel transfers (two Prisma clients): full debits when sum ≤ balance", async () => {
    await wipePublicTables(prisma);
    const s = await seedRaceScenario();

    const svcA = new WalletService({
      repo: createPrismaWalletRepository(prisma),
      bus: noopBus,
      engine: permissionsEngine,
    });
    const svcB = new WalletService({
      repo: createPrismaWalletRepository(prismaB),
      bus: noopBus,
      engine: permissionsEngine,
    });

    const results = await Promise.allSettled([
      svcA.transfer(s.stateId, s.ctx, {
        from: { kind: "personal" },
        to: { kind: "user", userId: s.bobId },
        amount: 60,
      }),
      svcB.transfer(s.stateId, s.ctx, {
        from: { kind: "personal" },
        to: { kind: "user", userId: s.bobId },
        amount: 40,
      }),
    ]);

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const aliceAfter = await prisma.wallet.findUniqueOrThrow({
      where: { id: s.aliceWalletId },
    });
    expect(ledgerDecimal(aliceAfter.balance).equals(new Decimal(0))).toBe(true);
  });
});
