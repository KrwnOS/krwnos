/**
 * Long-polling worker для Telegram Bot API (альтернатива webhook).
 *
 *   KRWN_TELEGRAM_BOT_TOKEN=… KRWN_TELEGRAM_BOT_USERNAME=MyBot \
 *   npx tsx scripts/telegram-polling.ts
 *
 * Тот же обработчик, что и `POST /api/telegram/webhook`, без заголовка secret
 * (доверяем только локальному процессу с токеном).
 */

import { registerTelegramCredentialProviderIfConfigured } from "@/lib/auth/register-telegram-credentials";
import { handleTelegramWebhookUpdate } from "@/lib/auth/telegram-webhook-handler";

registerTelegramCredentialProviderIfConfigured();

const token = process.env.KRWN_TELEGRAM_BOT_TOKEN?.trim();
if (!token) {
  console.error("KRWN_TELEGRAM_BOT_TOKEN is required");
  process.exit(1);
}

let offset = 0;

async function pollOnce(): Promise<void> {
  const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
  url.searchParams.set("timeout", "45");
  url.searchParams.set("offset", String(offset));

  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`getUpdates ${res.status}: ${t}`);
  }
  const data = (await res.json()) as {
    ok?: boolean;
    result?: Array<{ update_id: number } & Record<string, unknown>>;
  };
  if (!data.ok || !Array.isArray(data.result)) {
    return;
  }

  for (const u of data.result) {
    await handleTelegramWebhookUpdate(u);
    offset = u.update_id + 1;
  }
}

async function main(): Promise<void> {
  console.error("telegram-polling: started (Ctrl+C to stop)");
  for (;;) {
    try {
      await pollOnce();
    } catch (e) {
      console.error("telegram-polling error:", e);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

void main();
