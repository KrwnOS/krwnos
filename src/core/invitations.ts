/**
 * Invitations Service — «Магические ссылки» и QR-паспорта.
 * ------------------------------------------------------------
 * Поток:
 *   1. Суверен (или держатель `invitations.create`) выпускает
 *      приглашение, привязанное к конкретному `targetNodeId`.
 *   2. Ядро возвращает ОДНОРАЗОВЫЙ plaintext-токен и URL.
 *      В БД хранится только SHA-256(token).
 *   3. Получатель открывает `/invite/<token>`, проходит
 *      passkey/wallet challenge → `consume()` создаёт
 *      `Membership` в целевом узле.
 *
 * Сервис НЕ знает про Next.js и HTTP. Контроллеры (app/api)
 * оборачивают его в роуты.
 */

import { randomBytes, createHash } from "node:crypto";
import type {
  Invitation,
  InvitationStatus,
  IssuedInvitation,
  PermissionKey,
  UserRef,
} from "@/types/kernel";

export interface InvitationsRepository {
  insert(row: {
    id: string;
    stateId: string;
    targetNodeId: string | null;
    createdById: string;
    tokenHash: string;
    code: string;
    label: string | null;
    maxUses: number;
    expiresAt: Date | null;
  }): Promise<Invitation>;

  findByTokenHash(hash: string): Promise<Invitation | null>;
  findByCode(code: string): Promise<Invitation | null>;

  updateStatus(id: string, status: InvitationStatus, consumedAt?: Date): Promise<void>;
  incrementUses(id: string): Promise<Invitation>;

  createMembership(userId: string, nodeId: string): Promise<void>;
}

export interface CreateInvitationInput {
  stateId: string;
  targetNodeId: string | null;
  createdBy: UserRef;
  label?: string;
  maxUses?: number;
  ttlMs?: number;
  /** Optional origin used to build the share URL; defaults to APP_URL env. */
  origin?: string;
}

export interface ConsumeInvitationInput {
  token: string;
  user: UserRef;
}

export interface ConsumeResult {
  invitation: Invitation;
  placedAtNodeId: string | null;
}

/** Canonical permission keys owned by the kernel for invitations. */
export const InvitationPermissions = {
  Create: "invitations.create" as PermissionKey,
  Revoke: "invitations.revoke" as PermissionKey,
  View: "invitations.view" as PermissionKey,
};

export class InvitationTokenError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_found"
      | "expired"
      | "revoked"
      | "exhausted"
      | "already_member",
  ) {
    super(message);
    this.name = "InvitationTokenError";
  }
}

export class InvitationsService {
  constructor(private readonly repo: InvitationsRepository) {}

  async create(input: CreateInvitationInput): Promise<IssuedInvitation> {
    const token = generateToken();
    const tokenHash = sha256(token);
    const code = generateCode();
    const id = cuidish();

    const expiresAt = input.ttlMs ? new Date(Date.now() + input.ttlMs) : null;

    const invitation = await this.repo.insert({
      id,
      stateId: input.stateId,
      targetNodeId: input.targetNodeId,
      createdById: input.createdBy.id,
      tokenHash,
      code,
      label: input.label ?? null,
      maxUses: input.maxUses ?? 1,
      expiresAt,
    });

    const origin = input.origin ?? process.env.APP_URL ?? "http://localhost:3000";
    const url = `${origin.replace(/\/$/, "")}/invite/${token}`;

    return { invitation, token, url };
  }

  async consume(input: ConsumeInvitationInput): Promise<ConsumeResult> {
    const hash = sha256(input.token);
    const invitation = await this.repo.findByTokenHash(hash);
    if (!invitation) {
      throw new InvitationTokenError("Invitation not found", "not_found");
    }

    this.assertUsable(invitation);

    const updated = await this.repo.incrementUses(invitation.id);

    if (updated.targetNodeId) {
      await this.repo.createMembership(input.user.id, updated.targetNodeId);
    }

    if (updated.usesCount >= updated.maxUses) {
      await this.repo.updateStatus(updated.id, "consumed", new Date());
    }

    return {
      invitation: updated,
      placedAtNodeId: updated.targetNodeId,
    };
  }

  async revoke(id: string): Promise<void> {
    await this.repo.updateStatus(id, "revoked");
  }

  private assertUsable(inv: Invitation): void {
    if (inv.status === "revoked") {
      throw new InvitationTokenError("Invitation revoked", "revoked");
    }
    if (inv.status === "consumed") {
      throw new InvitationTokenError("Invitation already used", "exhausted");
    }
    if (inv.expiresAt && inv.expiresAt.getTime() < Date.now()) {
      throw new InvitationTokenError("Invitation expired", "expired");
    }
    if (inv.usesCount >= inv.maxUses) {
      throw new InvitationTokenError("Invitation exhausted", "exhausted");
    }
  }
}

// ------------------------------------------------------------
// helpers
// ------------------------------------------------------------

function generateToken(): string {
  // 32 bytes = 256 bits of entropy, base64url-encoded.
  return randomBytes(32).toString("base64url");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Compact human code "KRWN-XXXX-XXXX" suitable for QR text and
 * verbal sharing. Crockford alphabet to avoid ambiguous chars.
 */
function generateCode(): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const pick = () => {
    const b = randomBytes(4);
    let s = "";
    for (const byte of b) s += alphabet[byte % alphabet.length];
    return s;
  };
  return `KRWN-${pick()}-${pick()}`;
}

/**
 * Minimal cuid-like id — used only when the caller doesn't bring
 * a database default. Not cryptographically unique; repositories
 * should prefer their native id generators.
 */
function cuidish(): string {
  return `inv_${Date.now().toString(36)}${randomBytes(6).toString("hex")}`;
}
