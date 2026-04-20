/**
 * POST /api/telegram/link/start
 *
 * Требует Bearer CLI-токен со scope `credentials.telegram.link` (или `*`).
 * Выдаёт одноразовый deep link для привязки Telegram ↔ текущий User.
 */

import { NextResponse, type NextRequest } from "next/server";
import { authenticateCli, CliAuthError, requireScope } from "@/app/api/cli/auth";
import { pushCliLookup } from "@/app/api/push/_cli";
import { credentialsRegistry, CredentialsPermissions } from "@/core";
import { prisma } from "@/lib/prisma";
import { rateLimitedResponse } from "@/lib/rate-limit";
import { rejectIfCrossSiteMutation } from "@/lib/same-origin-mutation";
import type { TelegramCredentialProvider } from "@/lib/auth/telegram-credential-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const limited = await rateLimitedResponse(req, "api_telegram_link_start");
  if (limited) return limited;

  const csrf = rejectIfCrossSiteMutation(req);
  if (csrf) return csrf;

  let cli;
  try {
    cli = await authenticateCli(req, pushCliLookup);
  } catch (e) {
    if (e instanceof CliAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  try {
    requireScope(cli, CredentialsPermissions.TelegramLink);
  } catch (e) {
    if (e instanceof CliAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  if (!credentialsRegistry.enabledKinds().includes("telegram")) {
    return NextResponse.json(
      { error: "telegram_not_configured", code: "telegram_not_configured" },
      { status: 503 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: cli.userId },
    select: {
      id: true,
      handle: true,
      displayName: true,
      avatarUrl: true,
    },
  });
  if (!user) {
    return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  }

  const provider = credentialsRegistry.get(
    "telegram",
  ) as TelegramCredentialProvider;

  const enrollment = (await provider.beginEnrollment({
    id: user.id,
    handle: user.handle,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  })) as Record<string, unknown>;

  return NextResponse.json({ ok: true, ...enrollment }, { status: 200 });
}
