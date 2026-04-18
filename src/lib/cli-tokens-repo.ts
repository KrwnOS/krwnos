/**
 * Prisma-bound CliTokenRepository. Keeps DB code out of core.
 */
import { prisma } from "@/lib/prisma";
import type { CliTokenRepository, CliTokenRow } from "@/core/cli-tokens";

export const cliTokenRepository: CliTokenRepository = {
  findById: async (id) => toDomain(await prisma.cliToken.findUnique({ where: { id } })),
  findByHash: async (tokenHash) =>
    toDomain(await prisma.cliToken.findUnique({ where: { tokenHash } })),

  insert: async (row) => {
    const created = await prisma.cliToken.create({
      data: {
        userId: row.userId,
        stateId: row.stateId,
        tokenHash: row.tokenHash,
        label: row.label,
        scopes: row.scopes,
        expiresAt: row.expiresAt,
      },
    });
    return toDomain(created)!;
  },

  revoke: async (id, at) => {
    await prisma.cliToken.update({
      where: { id },
      data: { revokedAt: at },
    });
  },
};

function toDomain(row: {
  id: string;
  userId: string;
  stateId: string | null;
  label: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
} | null): CliTokenRow | null {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    stateId: row.stateId,
    label: row.label,
    scopes: row.scopes,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  };
}
