/**
 * Payroll periodic tick — TREASURY → PERSONAL, idempotency, income tax, activity path.
 * `TEST_DATABASE_URL` + `KRWN_INTEGRATION=1` or CI.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { runPayrollPeriodicTick } from "../payroll-tick";

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

describe.skipIf(!url)("payroll-tick integration (TEST_DATABASE_URL)", () => {
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

  it("pays once per period, applies income tax, idempotent on second run", async () => {
    const suffix = randomUUID().slice(0, 8);
    const owner = await prisma.user.create({
      data: {
        handle: `pay-owner-${suffix}`,
        email: `pay-owner-${suffix}@test.local`,
      },
    });
    const citizen = await prisma.user.create({
      data: {
        handle: `pay-cit-${suffix}`,
        email: `pay-cit-${suffix}@test.local`,
      },
    });

    const state = await prisma.state.create({
      data: {
        slug: `st-pay-${suffix}`,
        name: "Payrolland",
        ownerId: owner.id,
      },
    });

    await prisma.stateSettings.update({
      where: { stateId: state.id },
      data: {
        payrollEnabled: true,
        payrollAmountPerCitizen: 100,
        incomeTaxRate: 0.1,
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

    await prisma.wallet.create({
      data: {
        stateId: state.id,
        type: "TREASURY",
        nodeId: root.id,
        address: `krwn1tre${suffix}`,
        currency: "KRN",
        assetId: asset.id,
        balance: 10_000,
      },
    });

    await prisma.membership.create({
      data: {
        userId: citizen.id,
        nodeId: root.id,
        status: "active",
      },
    });

    await prisma.wallet.create({
      data: {
        stateId: state.id,
        type: "PERSONAL",
        userId: citizen.id,
        address: `krwn1usr${suffix}`,
        currency: "KRN",
        assetId: asset.id,
        balance: 0,
      },
    });

    const periodKey = "2031-04";

    const first = await runPayrollPeriodicTick({
      periodKey,
      now: new Date("2031-04-10T12:00:00Z"),
    });
    expect(first.usersPaid).toBe(1);
    expect(first.usersSkippedDuplicate).toBe(0);

    const personal = await prisma.wallet.findFirstOrThrow({
      where: {
        stateId: state.id,
        userId: citizen.id,
        type: "PERSONAL",
      },
    });
    expect(Number(personal.balance)).toBe(90);

    const second = await runPayrollPeriodicTick({
      periodKey,
      now: new Date("2031-04-11T12:00:00Z"),
    });
    expect(second.usersPaid).toBe(0);
    expect(second.usersSkippedDuplicate).toBe(1);

    const personalAfter = await prisma.wallet.findFirstOrThrow({
      where: {
        stateId: state.id,
        userId: citizen.id,
        type: "PERSONAL",
      },
    });
    expect(Number(personalAfter.balance)).toBe(90);

    const payout = await prisma.payrollPeriodPayout.findFirst({
      where: { stateId: state.id, userId: citizen.id, periodKey },
    });
    expect(payout?.transactionId).toBeTruthy();
  });
});
