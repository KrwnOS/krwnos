import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { CredentialRepository } from "@/core";
import { TelegramCredentialProvider } from "../telegram-credential-provider";

describe("TelegramCredentialProvider", () => {
  it("consumeLinkAndAttachCredential creates credential and marks token consumed", async () => {
    const startParam = "link_testtoken123456789012345678";
    const userId = "user-1";

    const repo: CredentialRepository = {
      findByIdentifier: vi.fn().mockResolvedValue(null),
      listForUser: vi.fn(),
      insert: vi.fn().mockResolvedValue({
        id: "cred-1",
        userId,
        kind: "telegram",
        identifier: "99",
        label: "@neo",
        lastUsedAt: null,
        createdAt: new Date(),
        revokedAt: null,
      }),
      markUsed: vi.fn(),
      revoke: vi.fn(),
    };

    const tokenRow = {
      id: "tok-1",
      userId,
      tokenHash: createHash("sha256")
        .update(startParam, "utf8")
        .digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    };

    const prisma = {
      telegramLinkToken: {
        findUnique: vi.fn().mockResolvedValue(tokenRow),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: userId,
          handle: "neo",
          displayName: "Neo",
          avatarUrl: null,
        }),
      },
    };

    const p = new TelegramCredentialProvider({
      repo,
      prisma: prisma as never,
      botUsername: "TestBot",
      linkTtlMs: 60_000,
    });

    const out = await p.consumeLinkAndAttachCredential({
      startParam,
      telegramUserId: 99,
      telegramUsername: "neo",
    });

    expect(out.userRef.handle).toBe("neo");
    expect(repo.insert).toHaveBeenCalled();
    expect(prisma.telegramLinkToken.update).toHaveBeenCalled();
  });

  it("completeLogin returns UserRef when credential exists", async () => {
    const repo: CredentialRepository = {
      findByIdentifier: vi.fn().mockResolvedValue({
        id: "c1",
        userId: "u1",
        kind: "telegram",
        identifier: "42",
        label: null,
        lastUsedAt: null,
        createdAt: new Date(),
        revokedAt: null,
      }),
      listForUser: vi.fn(),
      insert: vi.fn(),
      markUsed: vi.fn(),
      revoke: vi.fn(),
    };

    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "u1",
          handle: "trinity",
          displayName: null,
          avatarUrl: null,
        }),
      },
    };

    const p = new TelegramCredentialProvider({
      repo,
      prisma: prisma as never,
      botUsername: "TestBot",
    });

    const u = await p.completeLogin({ telegramUserId: 42 });
    expect(u.handle).toBe("trinity");
    expect(repo.markUsed).toHaveBeenCalledWith("c1");
  });
});
