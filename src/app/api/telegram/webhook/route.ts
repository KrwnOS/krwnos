/**
 * POST /api/telegram/webhook
 *
 * Webhook Telegram Bot API. Защита: заголовок `X-Telegram-Bot-Api-Secret-Token`
 * должен совпадать с `KRWN_TELEGRAM_WEBHOOK_SECRET` (как при `setWebhook`).
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  assertTelegramWebhookSecret,
  handleTelegramWebhookUpdate,
} from "@/lib/auth/telegram-webhook-handler";
import { rateLimitedResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const limited = await rateLimitedResponse(req, "api_telegram_webhook");
  if (limited) return limited;

  if (!assertTelegramWebhookSecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const result = await handleTelegramWebhookUpdate(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 200 });
}
