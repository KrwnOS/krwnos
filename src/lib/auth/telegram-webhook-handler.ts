/**
 * Обработка входящего webhook: привязка Telegram ↔ User по одноразовому `link_…`.
 */

import { credentialsRegistry } from "@/core";
import { telegramSendMessage } from "./telegram-api";
import type { TelegramCredentialProvider } from "./telegram-credential-provider";
import { parseStartWithParam } from "./telegram-update";

function getBotToken(): string | null {
  return process.env.KRWN_TELEGRAM_BOT_TOKEN?.trim() || null;
}

function telegramEnabled(): boolean {
  return credentialsRegistry.enabledKinds().includes("telegram");
}

export interface HandleTelegramWebhookResult {
  ok: boolean;
  /** Человекочитаемая причина для логов (без секретов). */
  detail?: string;
}

/**
 * Разбирает JSON тела, при успешной привязке шлёт ответ в чат.
 */
export async function handleTelegramWebhookUpdate(
  body: unknown,
  opts?: { fetchImpl?: typeof fetch },
): Promise<HandleTelegramWebhookResult> {
  if (!telegramEnabled()) {
    return { ok: false, detail: "telegram_provider_disabled" };
  }

  const botToken = getBotToken();
  if (!botToken) {
    return { ok: false, detail: "missing_bot_token" };
  }

  const parsed = parseStartWithParam(body);
  if (!parsed) {
    return { ok: true, detail: "ignored_non_start" };
  }

  const provider = credentialsRegistry.get(
    "telegram",
  ) as TelegramCredentialProvider;

  try {
    const { userRef } = await provider.consumeLinkAndAttachCredential({
      startParam: parsed.startParam,
      telegramUserId: parsed.telegramUser.id,
      telegramUsername: parsed.telegramUser.username,
    });

    await telegramSendMessage({
      botToken,
      chatId: parsed.chatId,
      text: `Linked KrwnOS account @${userRef.handle}. You can close this chat.`,
      fetchImpl: opts?.fetchImpl,
    });

    return { ok: true, detail: "linked" };
  } catch (e) {
    const code = e instanceof Error ? e.message : String(e);
    const reply =
      code === "link_expired" || code === "link_not_found_or_used"
        ? "This link expired or was already used. Open KrwnOS and generate a new Telegram link."
        : code === "telegram_already_linked"
          ? "This Telegram account is already linked to another KrwnOS user."
          : code === "invalid_start_param"
            ? "Invalid link. Open KrwnOS and try again."
            : "Could not complete linking. Try again from the app.";

    try {
      await telegramSendMessage({
        botToken,
        chatId: parsed.chatId,
        text: reply,
        fetchImpl: opts?.fetchImpl,
      });
    } catch {
      /* ignore secondary failure */
    }

    return { ok: false, detail: code };
  }
}

export function assertTelegramWebhookSecret(req: Request): boolean {
  const expected = process.env.KRWN_TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!expected) {
    return false;
  }
  const got = req.headers.get("x-telegram-bot-api-secret-token")?.trim();
  return got === expected;
}
