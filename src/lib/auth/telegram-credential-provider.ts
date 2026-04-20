/**
 * Telegram bot — `CredentialProvider` для `AuthCredentialKind.telegram`.
 * Токен бота читается из окружения (как VAPID), не из БД.
 */

import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { AuthCredential, UserRef } from "@/types/kernel";
import type {
  CredentialProvider,
  CredentialRepository,
} from "@/core/auth-credentials";

export interface TelegramCredentialProviderOptions {
  repo: CredentialRepository;
  prisma: PrismaClient;
  /** Без @, например `KrwnOSBot` — для deep link `t.me/...`. */
  botUsername: string;
  /** TTL одноразовой ссылки привязки (мс). */
  linkTtlMs?: number;
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function parseTelegramUserId(response: unknown): string | null {
  if (
    response &&
    typeof response === "object" &&
    "telegramUserId" in response
  ) {
    const v = (response as { telegramUserId: unknown }).telegramUserId;
    if (typeof v === "number" && Number.isFinite(v)) {
      return String(Math.trunc(v));
    }
    if (typeof v === "string" && /^\d+$/.test(v)) {
      return v;
    }
  }
  return null;
}

export class TelegramCredentialProvider implements CredentialProvider {
  readonly kind = "telegram" as const;

  private readonly repo: CredentialRepository;
  private readonly prisma: PrismaClient;
  private readonly botUsername: string;
  private readonly linkTtlMs: number;

  constructor(opts: TelegramCredentialProviderOptions) {
    this.repo = opts.repo;
    this.prisma = opts.prisma;
    this.botUsername = opts.botUsername.replace(/^@/, "");
    this.linkTtlMs = opts.linkTtlMs ?? 15 * 60 * 1000;
  }

  async beginEnrollment(user: UserRef): Promise<unknown> {
    const raw = randomBytes(18).toString("base64url");
    const startParam = `link_${raw}`;
    const tokenHash = sha256Hex(startParam);
    const expiresAt = new Date(Date.now() + this.linkTtlMs);

    await this.prisma.telegramLinkToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    const deepLink = `https://t.me/${this.botUsername}?start=${encodeURIComponent(startParam)}`;
    return {
      botUsername: this.botUsername,
      startParam,
      deepLink,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async completeEnrollment(
    _user: UserRef,
    _response: unknown,
  ): Promise<AuthCredential> {
    throw new Error(
      "[KrwnOS] Telegram enrollment completes via the bot /start webhook, not this API.",
    );
  }

  async beginLogin(_identifierHint?: string): Promise<unknown> {
    return {
      mode: "telegram",
      botUsername: this.botUsername,
      hint:
        "If your Telegram account is already linked, the app can complete login after a verified Telegram update.",
    };
  }

  async completeLogin(response: unknown): Promise<UserRef> {
    const telegramUserId = parseTelegramUserId(response);
    if (!telegramUserId) {
      throw new Error("[KrwnOS] Telegram completeLogin: invalid response");
    }

    const cred = await this.repo.findByIdentifier("telegram", telegramUserId);
    if (!cred) {
      throw new Error("[KrwnOS] No Telegram credential for this user id");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: cred.userId },
      select: {
        id: true,
        handle: true,
        displayName: true,
        avatarUrl: true,
      },
    });
    if (!user) {
      throw new Error("[KrwnOS] Telegram credential references missing user");
    }

    await this.repo.markUsed(cred.id);

    return {
      id: user.id,
      handle: user.handle,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    };
  }

  /**
   * Вызывается из webhook/polling после проверки секрета и разбора `/start link_…`.
   */
  async consumeLinkAndAttachCredential(input: {
    startParam: string;
    telegramUserId: number;
    telegramUsername?: string;
  }): Promise<{ userRef: UserRef; credential: AuthCredential }> {
    const startParam = input.startParam.trim();
    if (!startParam.startsWith("link_")) {
      throw new Error("invalid_start_param");
    }

    const tokenHash = sha256Hex(startParam);
    const row = await this.prisma.telegramLinkToken.findUnique({
      where: { tokenHash },
    });

    if (!row || row.consumedAt) {
      throw new Error("link_not_found_or_used");
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw new Error("link_expired");
    }

    const identifier = String(Math.trunc(input.telegramUserId));

    const existing = await this.repo.findByIdentifier("telegram", identifier);
    if (existing && existing.userId !== row.userId) {
      throw new Error("telegram_already_linked");
    }

    let credential: AuthCredential;
    try {
      if (existing) {
        credential = existing;
      } else {
        credential = await this.repo.insert({
          id: "",
          userId: row.userId,
          kind: "telegram",
          identifier,
          label: input.telegramUsername ? `@${input.telegramUsername}` : null,
          metadata: {
            telegramUsername: input.telegramUsername ?? null,
            linkedAt: new Date().toISOString(),
          },
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Unique constraint") || msg.includes("P2002")) {
        throw new Error("telegram_already_linked");
      }
      throw e;
    }

    await this.prisma.telegramLinkToken.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: {
        id: true,
        handle: true,
        displayName: true,
        avatarUrl: true,
      },
    });
    if (!user) {
      throw new Error("[KrwnOS] User missing after Telegram link");
    }

    return {
      userRef: {
        id: user.id,
        handle: user.handle,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
      credential,
    };
  }
}
