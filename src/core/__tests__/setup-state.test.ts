/**
 * Unit tests for `setupState` (`src/core/setup-state.ts`).
 * Идемпотентность и симуляция сбоя внутри interactive transaction —
 * без реальной БД (мок `prisma`).
 * Интеграция с PostgreSQL: `setup-state.integration.test.ts` + TEST_DATABASE_URL.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { stateCount, transaction } = vi.hoisted(() => ({
  stateCount: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    state: { count: stateCount },
    $transaction: transaction,
  },
}));

import {
  AlreadyInitialisedError,
  setupState,
  type SetupStateInput,
} from "../setup-state";

const validInput: SetupStateInput = {
  stateName: "Test Realm",
  ownerHandle: "sov_unit",
  firstInvite: null,
};

describe("setupState (mocked prisma)", () => {
  beforeEach(() => {
    stateCount.mockReset();
    transaction.mockReset();
  });

  it("throws AlreadyInitialisedError and skips transaction when a State already exists", async () => {
    stateCount.mockResolvedValue(1);

    await expect(setupState(validInput)).rejects.toBeInstanceOf(
      AlreadyInitialisedError,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it("runs bootstrap only inside prisma.$transaction when no State exists", async () => {
    stateCount.mockResolvedValue(0);
    transaction.mockRejectedValue(new Error("should not surface"));

    await expect(setupState(validInput)).rejects.toThrow("should not surface");
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  /**
   * Контракт: весь bootstrap выполняется в одном `prisma.$transaction`.
   * При ошибке внутри callback PostgreSQL откатывает транзакцию (нет «полузаписи»).
   * Здесь мок симулирует отказ на `state.create` после успешного `user.create`:
   * наружу пробрасывается ошибка, цепочка не доходит до узлов/кошелька.
   */
  it("propagates failure from inside the transaction (simulated mid-bootstrap error)", async () => {
    stateCount.mockResolvedValue(0);

    const userCreate = vi.fn().mockResolvedValue({ id: "u-test" });
    const stateCreate = vi
      .fn()
      .mockRejectedValue(new Error("simulated DB failure after user"));

    transaction.mockImplementation(
      async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const tx = {
          user: { create: userCreate },
          state: { create: stateCreate },
          verticalNode: { create: vi.fn() },
          membership: { create: vi.fn() },
          wallet: { create: vi.fn() },
          cliToken: { create: vi.fn() },
          invitation: { create: vi.fn() },
        };
        return fn(tx as never);
      },
    );

    await expect(setupState(validInput)).rejects.toThrow(
      "simulated DB failure after user",
    );
    expect(userCreate).toHaveBeenCalledTimes(1);
    expect(stateCreate).toHaveBeenCalledTimes(1);
  });
});
