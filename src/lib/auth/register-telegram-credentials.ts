/**
 * Регистрирует `TelegramCredentialProvider` в `credentialsRegistry`, если заданы env.
 * Вызывается из `instrumentation.ts` (Node runtime).
 */

import { credentialsRegistry } from "@/core";
import { prisma } from "@/lib/prisma";
import { PrismaCredentialRepository } from "./prisma-credential-repository";
import { TelegramCredentialProvider } from "./telegram-credential-provider";

let registered = false;

export function registerTelegramCredentialProviderIfConfigured(): void {
  if (registered) return;

  const token = process.env.KRWN_TELEGRAM_BOT_TOKEN?.trim();
  const username = process.env.KRWN_TELEGRAM_BOT_USERNAME?.trim();
  if (!token || !username) {
    return;
  }

  const repo = new PrismaCredentialRepository(prisma);
  const provider = new TelegramCredentialProvider({
    repo,
    prisma,
    botUsername: username,
  });

  try {
    credentialsRegistry.register(provider);
    registered = true;
  } catch (e) {
    if (e instanceof Error && e.message.includes("already registered")) {
      registered = true;
      return;
    }
    throw e;
  }
}
