import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSandboxedContext } from "../module-sandbox";
import { prisma } from "@/lib/prisma";
import * as vault from "../module-secret-vault";
import type { PermissionKey } from "@krwnos/sdk";

// Mock prisma
vi.mock("@/lib/prisma", () => ({
  prisma: {
    installedModule: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// Mock module-secret-vault
vi.mock("../module-secret-vault", () => ({
  decryptModuleSecret: vi.fn(),
}));

describe("createSandboxedContext", () => {
  const options = {
    stateId: "state_12345678_xyz",
    userId: "user_123",
    moduleSlug: "test.module",
    permissions: new Set<PermissionKey>(["*"]),
    bus: { emit: vi.fn(), on: vi.fn() } as any,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.AUTH_SECRET = "super_secret_for_testing_purposes";
  });

  describe("secrets", () => {
    it("should return null if module config has no secrets", async () => {
      vi.mocked(prisma.installedModule.findUnique).mockResolvedValueOnce({
        config: {},
      } as any);

      const ctx = createSandboxedContext(options);
      const secret = await ctx.secrets.get("api_key");
      expect(secret).toBeNull();
    });

    it("should decrypt and return a secret if it exists", async () => {
      vi.mocked(prisma.installedModule.findUnique).mockResolvedValueOnce({
        config: { secrets: { api_key: "encrypted_payload" } },
      } as any);
      vi.mocked(vault.decryptModuleSecret).mockReturnValue("decrypted_key");

      const ctx = createSandboxedContext(options);
      const secret = await ctx.secrets.get("api_key");
      
      expect(vault.decryptModuleSecret).toHaveBeenCalledWith(
        "state_12345678_xyz",
        "encrypted_payload",
        "super_secret_for_testing_purposes"
      );
      expect(secret).toBe("decrypted_key");
    });

    it("should return null if decryption fails", async () => {
      vi.mocked(prisma.installedModule.findUnique).mockResolvedValueOnce({
        config: { secrets: { api_key: "encrypted_payload" } },
      } as any);
      vi.mocked(vault.decryptModuleSecret).mockImplementation(() => {
        throw new Error("Bad key");
      });

      const ctx = createSandboxedContext(options);
      const secret = await ctx.secrets.get("api_key");
      expect(secret).toBeNull();
    });
  });

  describe("database", () => {
    it("should provide an interactive transaction that sets search_path", async () => {
      // Mock $transaction to immediately execute the callback
      const mockTx = {
        $executeRawUnsafe: vi.fn().mockResolvedValue(1),
        $queryRawUnsafe: vi.fn().mockResolvedValue([{ id: 1 }]),
      };
      vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
        return await (callback as any)(mockTx);
      });

      const ctx = createSandboxedContext(options);
      
      const result = await ctx.db.transaction(async (tx) => {
        return await tx.queryRaw("SELECT * FROM test_table");
      });

      // Assert that search_path was set correctly
      // slug "test.module" -> "test_module"
      // stateId "state_12345678_xyz" prefix -> "state_12"
      // -> "krwn_test_module_state_12"
      expect(mockTx.$executeRawUnsafe).toHaveBeenCalledWith('SET LOCAL search_path TO "krwn_test_module_state_12"');
      
      // Assert the actual query ran
      expect(mockTx.$queryRawUnsafe).toHaveBeenCalledWith("SELECT * FROM test_table");
      expect(result).toEqual([{ id: 1 }]);
    });
  });
});
