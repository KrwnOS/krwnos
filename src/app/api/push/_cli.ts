import type { CliTokenLookup } from "@/app/api/cli/auth";
import { prisma } from "@/lib/prisma";

/** CLI token lookup for `/api/push/*` (Bearer matches `Chat`-scoped routes). */
export const pushCliLookup: CliTokenLookup = {
  findByHash: async (tokenHash: string) =>
    prisma.cliToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        stateId: true,
        scopes: true,
        expiresAt: true,
        revokedAt: true,
      },
    }),
  touch: async (id: string) =>
    void (await prisma.cliToken.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    })),
};
