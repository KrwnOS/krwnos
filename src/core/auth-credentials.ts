/**
 * Passwordless credentials registry.
 * ------------------------------------------------------------
 * Унифицированный слой поверх нескольких провайдеров идентичности:
 *   * Passkeys (WebAuthn)    — дефолт, браузерный.
 *   * Web3 wallets           — Ethereum / Solana signature challenge.
 *   * OAuth (GitHub, Google) — опционально.
 *   * Magic email link       — fallback.
 *
 * Core определяет только ПОРТ (интерфейс). Реальные адаптеры
 * подключаются в bootstrap-слое и могут использовать
 * `@simplewebauthn/server`, `siwe`, `lucia`, и т.д.
 */

import type { AuthCredential, AuthCredentialKind, UserRef } from "@/types/kernel";

export interface CredentialRepository {
  findByIdentifier(
    kind: AuthCredentialKind,
    identifier: string,
  ): Promise<AuthCredential | null>;

  listForUser(userId: string): Promise<AuthCredential[]>;

  insert(row: Omit<AuthCredential, "createdAt" | "lastUsedAt" | "revokedAt"> & {
    publicKey?: Uint8Array | null;
    metadata?: Record<string, unknown>;
  }): Promise<AuthCredential>;

  markUsed(id: string): Promise<void>;
  revoke(id: string): Promise<void>;
}

/**
 * Challenge/response flow shared by all kinds:
 *   1. beginChallenge() returns provider-specific blob (e.g. WebAuthn
 *      options or SIWE message).
 *   2. verifyResponse() validates and (on success) returns UserRef.
 */
export interface CredentialProvider {
  readonly kind: AuthCredentialKind;

  beginEnrollment(user: UserRef): Promise<unknown>;
  completeEnrollment(user: UserRef, response: unknown): Promise<AuthCredential>;

  beginLogin(identifierHint?: string): Promise<unknown>;
  completeLogin(response: unknown): Promise<UserRef>;
}

export class CredentialsRegistry {
  private readonly providers = new Map<AuthCredentialKind, CredentialProvider>();

  register(provider: CredentialProvider): void {
    if (this.providers.has(provider.kind)) {
      throw new Error(
        `[KrwnOS] Credential provider for "${provider.kind}" is already registered.`,
      );
    }
    this.providers.set(provider.kind, provider);
  }

  get(kind: AuthCredentialKind): CredentialProvider {
    const p = this.providers.get(kind);
    if (!p) {
      throw new Error(
        `[KrwnOS] No credential provider registered for "${kind}". ` +
          `Enable it during bootstrap.`,
      );
    }
    return p;
  }

  enabledKinds(): AuthCredentialKind[] {
    return [...this.providers.keys()];
  }
}

export const credentialsRegistry = new CredentialsRegistry();
