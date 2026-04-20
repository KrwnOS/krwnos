/**
 * Prisma-backed `CredentialRepository` — хранит строки `AuthCredential`.
 */

import type { PrismaClient } from "@prisma/client";
import type { AuthCredential, AuthCredentialKind } from "@/types/kernel";
import type { CredentialRepository } from "@/core";

function mapRow(row: {
  id: string;
  userId: string;
  kind: AuthCredentialKind;
  identifier: string;
  label: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}): AuthCredential {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    identifier: row.identifier,
    label: row.label,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  };
}

export class PrismaCredentialRepository implements CredentialRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByIdentifier(
    kind: AuthCredentialKind,
    identifier: string,
  ): Promise<AuthCredential | null> {
    const row = await this.prisma.authCredential.findFirst({
      where: { kind, identifier, revokedAt: null },
    });
    return row ? mapRow(row) : null;
  }

  async listForUser(userId: string): Promise<AuthCredential[]> {
    const rows = await this.prisma.authCredential.findMany({
      where: { userId, revokedAt: null },
    });
    return rows.map(mapRow);
  }

  async insert(
    row: Omit<AuthCredential, "createdAt" | "lastUsedAt" | "revokedAt"> & {
      publicKey?: Uint8Array | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<AuthCredential> {
    const created = await this.prisma.authCredential.create({
      data: {
        userId: row.userId,
        kind: row.kind,
        identifier: row.identifier,
        label: row.label ?? null,
        publicKey:
          row.publicKey != null ? Buffer.from(row.publicKey) : null,
        metadata: (row.metadata ?? {}) as object,
      },
    });
    void row.id;
    return mapRow(created);
  }

  async markUsed(id: string): Promise<void> {
    await this.prisma.authCredential.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.authCredential.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }
}
