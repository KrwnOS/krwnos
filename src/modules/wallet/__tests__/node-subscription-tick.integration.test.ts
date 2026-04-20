/**
 * Node subscription tick — дочерняя казна → родительская, идемпотентность.
 * `TEST_DATABASE_URL` + `KRWN_INTEGRATION=1` или CI.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { ledgerDecimal } from "../money";
import { runNodeSubscriptionTick } from "../node-subscription-tick";

const url =
  process.env.TEST_DATABASE_URL &&
  (process.env.GITHUB_ACTIONS === "true" ||
    process.env.KRWN_INTEGRATION === "1")
    ? process.env.TEST_DATABASE_URL
    : undefined;

async function wipePublicTables(
  p: import("@prisma/client").PrismaClient,
): Promise<void> {
  await p.$executeRawUnsafe(`
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

describe.skipIf(!url)("node-subscription-tick integration (TEST_DATABASE_URL)", () => {
  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", url!);
    const g = globalThis as { prisma?: import("@prisma/client").PrismaClient };
    delete g.prisma;
    vi.resetModules();
    await wipePublicTables((await import("@/lib/prisma")).prisma);
  });

  afterAll(async () => {
    await wipePublicTables(prisma);
    await prisma.$disconnect();
    vi.unstubAllEnvs();
  });

  it("moves funds from child treasury to parent once per period (fee split)", async () => {
    const suffix = randomUUID().slice(0, 8);
    const owner = await prisma.user.create({
      data: {
        handle: `ns-owner-${suffix}`,
        email: `ns-owner-${suffix}@test.local`,
      },
    });

    const state = await prisma.state.create({
      data: {
        slug: `st-ns-${suffix}`,
        name: "Subland",
        ownerId: owner.id,
      },
    });

    const root = await prisma.verticalNode.create({
      data: {
        stateId: state.id,
        parentId: null,
        title: "Root",
        type: "department",
      },
    });

    const child = await prisma.verticalNode.create({
      data: {
        stateId: state.id,
        parentId: root.id,
        title: "Child",
        type: "department",
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
      },
    });

    const rootTw = await prisma.wallet.create({
      data: {
        stateId: state.id,
        type: "TREASURY",
        nodeId: root.id,
        address: `krwn1r${suffix}`,
        currency: "KRN",
        assetId: asset.id,
        balance: 0,
      },
    });

    const childTw = await prisma.wallet.create({
      data: {
        stateId: state.id,
        type: "TREASURY",
        nodeId: child.id,
        address: `krwn1c${suffix}`,
        currency: "KRN",
        assetId: asset.id,
        balance: 100,
      },
    });

    await prisma.nodeSubscription.create({
      data: {
        stateId: state.id,
        childNodeId: child.id,
        parentNodeId: root.id,
        amount: 30,
        assetId: asset.id,
        schedule: "MONTHLY",
        enabled: true,
      },
    });

    const now = new Date("2026-04-15T00:00:00Z");
    const r1 = await runNodeSubscriptionTick({ now });
    expect(r1.chargesCreated).toBe(1);

    const afterChild = await prisma.wallet.findUnique({
      where: { id: childTw.id },
      select: { balance: true },
    });
    const afterRoot = await prisma.wallet.findUnique({
      where: { id: rootTw.id },
      select: { balance: true },
    });
    expect(ledgerDecimal(afterChild!.balance).toNumber()).toBe(70);
    expect(ledgerDecimal(afterRoot!.balance).toNumber()).toBe(30);

    const r2 = await runNodeSubscriptionTick({ now });
    expect(r2.skippedDuplicate).toBe(1);
    expect(r2.chargesCreated).toBe(0);
  });
});
