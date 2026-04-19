/**
 * Integration tests for `setupState` against a real PostgreSQL database.
 *
 * Задаётся `TEST_DATABASE_URL` (отдельная БД или та же, что CI — см. docs/SETUP.md).
 * Перед/после прогона таблицы `public` очищаются (кроме `_prisma_migrations`).
 *
 * Прогон: в CI (`GITHUB_ACTIONS=true`) или локально `KRWN_INTEGRATION=1` + URL.
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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

describe.skipIf(!url)("setupState integration (TEST_DATABASE_URL)", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let setupState: typeof import("../setup-state").setupState;
  let AlreadyInitialisedError: typeof import("../setup-state").AlreadyInitialisedError;

  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", url!);
    const g = globalThis as { prisma?: import("@prisma/client").PrismaClient };
    delete g.prisma;
    vi.resetModules();
    prisma = (await import("@/lib/prisma")).prisma;
    const mod = await import("../setup-state");
    setupState = mod.setupState;
    AlreadyInitialisedError = mod.AlreadyInitialisedError;
    await wipePublicTables(prisma);
  });

  afterAll(async () => {
    await wipePublicTables(prisma);
    await prisma.$disconnect();
    vi.unstubAllEnvs();
  });

  it("is idempotent: second setup throws AlreadyInitialisedError; no duplicate State/User", async () => {
    await wipePublicTables(prisma);

    const input = {
      stateName: "Integrationland",
      ownerHandle: "sov_integ",
      firstInvite: null,
    };

    const first = await setupState(input);
    expect(await prisma.state.count()).toBe(1);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.verticalNode.count()).toBe(2);

    await expect(
      setupState({ ...input, ownerHandle: "other_handle" }),
    ).rejects.toBeInstanceOf(AlreadyInitialisedError);

    expect(await prisma.state.count()).toBe(1);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.user.findUnique({ where: { id: first.userId } })).not
      .toBeNull();
  });

  /**
   * После успешного bootstrap в транзакции строки появляются согласованно.
   * (Полный откат при исключении внутри tx проверяется в unit-тесте с моком;
   * здесь подтверждаем happy-path на реальном драйвере.)
   */
  it("creates State, root nodes, wallet, and settings in one successful run", async () => {
    await wipePublicTables(prisma);

    await setupState({
      stateName: "Happy Path",
      ownerHandle: "sov_happy",
      firstInvite: null,
    });

    expect(await prisma.stateSettings.count()).toBe(1);
    expect(await prisma.wallet.count()).toBe(1);
    expect(await prisma.cliToken.count()).toBe(1);
  });
});
