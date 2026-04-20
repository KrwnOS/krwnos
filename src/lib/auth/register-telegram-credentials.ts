/**
 * Регистрирует `TelegramCredentialProvider` в `credentialsRegistry`, если заданы env.
 * Вызывается из `instrumentation.ts` (Node runtime).
 *
 * Тяжёлые модули (Prisma, `node:crypto`) подгружаются через `import()`, чтобы
 * webpack при сборке `instrumentation` не тянул Node builtins / Prisma runtime.
 */

import { credentialsRegistry } from "@/core/auth-credentials";

let registered = false;

export async function registerTelegramCredentialProviderIfConfigured(): Promise<void> {
  if (registered) return;

  const token = process.env.KRWN_TELEGRAM_BOT_TOKEN?.trim();
  const username = process.env.KRWN_TELEGRAM_BOT_USERNAME?.trim();
  if (!token || !username) {
    return;
  }

  const [{ prisma }, { PrismaCredentialRepository }, { TelegramCredentialProvider }] =
    await Promise.all([
      import(/* webpackIgnore: true */ "@/lib/prisma"),
      import(/* webpackIgnore: true */ "./prisma-credential-repository"),
      import(/* webpackIgnore: true */ "./telegram-credential-provider"),
    ]);

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
