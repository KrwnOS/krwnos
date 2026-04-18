/**
 * CLI tokens — mint / rotate / revoke.
 * ------------------------------------------------------------
 * Правила безопасности:
 *   * В БД хранится только SHA-256(token). Plaintext возвращается
 *     ровно один раз — в результате `mint()` или `rotate()`.
 *   * Новый токен после `rotate()` наследует scopes/stateId/expiry
 *     старого (если не переопределены).
 *   * Старый токен немедленно помечается `revokedAt = now()`.
 *     Никаких grace-периодов — CLI обязан обновить конфиг сразу.
 *
 * Сервис принимает порт `CliTokenRepository`, так что его
 * можно гонять в тестах без Prisma.
 */

import { randomBytes, createHash } from "node:crypto";

export interface CliTokenRow {
  id: string;
  userId: string;
  stateId: string | null;
  label: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export interface CliTokenRepository {
  findById(id: string): Promise<CliTokenRow | null>;
  findByHash(tokenHash: string): Promise<CliTokenRow | null>;

  insert(row: {
    userId: string;
    stateId: string | null;
    tokenHash: string;
    label: string;
    scopes: string[];
    expiresAt: Date | null;
  }): Promise<CliTokenRow>;

  revoke(id: string, at: Date): Promise<void>;
}

export interface MintCliTokenInput {
  userId: string;
  stateId: string | null;
  label: string;
  scopes: string[];
  ttlMs?: number;
}

export interface RotateCliTokenInput {
  /** Id of the token to rotate. Usually resolved from the current bearer. */
  currentTokenId: string;
  /** Optional overrides for the replacement token. */
  label?: string;
  scopes?: string[];
  ttlMs?: number | null;
}

export interface MintResult {
  id: string;
  /** Plaintext token. Shown ONCE. */
  token: string;
  row: CliTokenRow;
}

export interface RotateResult {
  revokedTokenId: string;
  /** Plaintext for the new token. Shown ONCE. */
  token: string;
  row: CliTokenRow;
}

export class CliTokenService {
  constructor(private readonly repo: CliTokenRepository) {}

  async mint(input: MintCliTokenInput): Promise<MintResult> {
    validateLabel(input.label);
    validateScopes(input.scopes);

    const token = generateToken();
    const tokenHash = sha256(token);

    const row = await this.repo.insert({
      userId: input.userId,
      stateId: input.stateId,
      tokenHash,
      label: input.label,
      scopes: input.scopes,
      expiresAt: input.ttlMs ? new Date(Date.now() + input.ttlMs) : null,
    });

    return { id: row.id, token, row };
  }

  async rotate(input: RotateCliTokenInput): Promise<RotateResult> {
    const current = await this.repo.findById(input.currentTokenId);
    if (!current) {
      throw new Error(`Token ${input.currentTokenId} not found.`);
    }
    if (current.revokedAt) {
      throw new Error("Token is already revoked; rotation blocked.");
    }

    const label = input.label ?? deriveRotatedLabel(current.label);
    const scopes = input.scopes ?? current.scopes;
    const ttlMs =
      input.ttlMs === null
        ? undefined
        : input.ttlMs ??
          (current.expiresAt
            ? current.expiresAt.getTime() - Date.now()
            : undefined);

    const minted = await this.mint({
      userId: current.userId,
      stateId: current.stateId,
      label,
      scopes,
      ttlMs: ttlMs && ttlMs > 0 ? ttlMs : undefined,
    });

    await this.repo.revoke(current.id, new Date());

    return {
      revokedTokenId: current.id,
      token: minted.token,
      row: minted.row,
    };
  }

  async revoke(id: string): Promise<void> {
    const row = await this.repo.findById(id);
    if (!row) throw new Error(`Token ${id} not found.`);
    if (row.revokedAt) return;
    await this.repo.revoke(id, new Date());
  }

  /** Resolve a plaintext token to its row (without side-effects). */
  async resolve(token: string): Promise<CliTokenRow | null> {
    return this.repo.findByHash(sha256(token));
  }
}

// ------------------------------------------------------------
// helpers
// ------------------------------------------------------------

function generateToken(): string {
  // "kt_" prefix makes tokens recognisable in logs / secret scanners.
  return `kt_${randomBytes(32).toString("base64url")}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validateLabel(label: string): void {
  if (!label || label.trim().length === 0) {
    throw new Error("Token label is required.");
  }
  if (label.length > 64) {
    throw new Error("Token label must be ≤ 64 chars.");
  }
}

function validateScopes(scopes: string[]): void {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error("At least one scope is required (use [\"*\"] for Sovereign).");
  }
  for (const s of scopes) {
    if (s === "*") continue;
    if (!/^[a-z]+(?:\.[a-z*]+)+$/.test(s)) {
      throw new Error(
        `Invalid scope "${s}". Expected "<domain>.<action>" or "<domain>.*".`,
      );
    }
  }
}

function deriveRotatedLabel(old: string): string {
  const base = old.replace(/\s+rotated\s*\(.+\)$/, "");
  const stamp = new Date().toISOString().slice(0, 10);
  return `${base} rotated (${stamp})`;
}
