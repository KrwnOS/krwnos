/**
 * Auth — kernel identity layer.
 * ------------------------------------------------------------
 * This file exposes the minimal surface the rest of the core
 * depends on: resolving the current `UserRef` from a request
 * context. The concrete implementation (NextAuth, Clerk,
 * custom JWT) is plugged in by the app layer.
 */

import type { UserRef } from "@/types/kernel";

export interface AuthAdapter {
  /** Returns the authenticated user or null for guests. */
  getCurrentUser(): Promise<UserRef | null>;
  /** Throws `UnauthorizedError` if no user is present. */
  requireUser(): Promise<UserRef>;
}

export class UnauthorizedError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Default no-op adapter so the project builds before a real
 * auth provider is wired in. Swap this via `setAuthAdapter()`.
 */
class NullAuthAdapter implements AuthAdapter {
  async getCurrentUser(): Promise<UserRef | null> {
    return null;
  }
  async requireUser(): Promise<UserRef> {
    throw new UnauthorizedError(
      "No AuthAdapter configured. Call setAuthAdapter() during bootstrap.",
    );
  }
}

let adapter: AuthAdapter = new NullAuthAdapter();

export function setAuthAdapter(next: AuthAdapter): void {
  adapter = next;
}

export function getAuth(): AuthAdapter {
  return adapter;
}
