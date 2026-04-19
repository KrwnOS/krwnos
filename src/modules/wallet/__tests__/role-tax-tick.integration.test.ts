/**
 * Role tax monthly tick — идемпотентность и списание в корневую Казну.
 * `TEST_DATABASE_URL` + `KRWN_INTEGRATION=1` или CI.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { runRoleTaxMonthlyTick } from "../role-tax-tick";

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

describe.skipIf(!url)("role-tax-tick integration (TEST_DATABASE_URL)", () => {
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

  it("charges once per period and is idempotent on second run", async () => {
    const suffix = randomUUID().slice(0, 8);
    const owner = await prisma.user.create({
      data: {
        handle: `rt-owner-${suffix}`,
        email: `rt-owner-${suffix}@test.local`,
      },
    });
    const citizen = await prisma.user.create({
      data: {
        handle: `rt-cit-${suffix}`,
        email: `rt-cit-${suffix}@test.local`,
      },
    });

    const state = await prisma.state.create({
      data: {
        slug: `st-rt-${suffix}`,
        name: "RoleTaxland",
        ownerId: owner.id,
      },
    });

    await prisma.stateSettings.update({
      where: { stateId: state.id },
      data: { roleTaxRate: 0.1 },
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
        balance: 0,
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
        balance: 1000,
      },
    });

    const periodKey = "2030-06";

    const first = await runRoleTaxMonthlyTick({
      periodKey,
      now: new Date("2030-06-15T12:00:00Z"),
    });
    expect(first.usersCharged).toBe(1);
    expect(first.usersSkippedDuplicate).toBe(0);

    const personal = await prisma.wallet.findFirstOrThrow({
      where: {
        stateId: state.id,
        userId: citizen.id,
        type: "PERSONAL",
      },
    });
    expect(Number(personal.balance)).toBe(900);

    const second = await runRoleTaxMonthlyTick({
      periodKey,
      now: new Date("2030-06-20T12:00:00Z"),
    });
    expect(second.usersCharged).toBe(0);
    expect(second.usersSkippedDuplicate).toBe(1);

    const personalAfter = await prisma.wallet.findFirstOrThrow({
      where: {
        stateId: state.id,
        userId: citizen.id,
        type: "PERSONAL",
      },
    });
    expect(Number(personalAfter.balance)).toBe(900);
  });
});
