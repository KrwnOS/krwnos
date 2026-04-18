/**
 * Authenticates a request coming from the `krwn` CLI.
 * ------------------------------------------------------------
 * Wire format:
 *   Authorization: Bearer <raw-cli-token>
 *
 * Server looks up SHA-256(token) in `CliToken`, updates lastUsedAt,
 * and returns an authorization context with State scope + scopes[].
 *
 * This module is intentionally framework-light so it can be reused
 * by route handlers, middleware, and tests.
 */

import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

export interface CliAuthContext {
  userId: string;
  stateId: string | null;
  scopes: string[];
  tokenId: string;
}

export class CliAuthError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403 = 401,
  ) {
    super(message);
    this.name = "CliAuthError";
  }
}

export interface CliTokenLookup {
  findByHash(tokenHash: string): Promise<
    | {
        id: string;
        userId: string;
        stateId: string | null;
        scopes: string[];
        expiresAt: Date | null;
        revokedAt: Date | null;
      }
    | null
  >;
  touch(id: string): Promise<void>;
}

export async function authenticateCli(
  req: NextRequest | Request,
  lookup: CliTokenLookup,
): Promise<CliAuthContext> {
  const header = req.headers.get("authorization") ?? "";
  let token = "";
  if (header.toLowerCase().startsWith("bearer ")) {
    token = header.slice(7).trim();
  } else {
    // SSE transports (native EventSource) cannot set Authorization
    // headers. Fall back to a `?token=` query parameter so the
    // in-browser UI can open /api/chat/stream without an extra proxy.
    // NB: query tokens can leak into access logs — this is acceptable
    // for MVP; production deployments should place the stream behind
    // a same-origin reverse proxy that strips access logs for it.
    try {
      const url = new URL(req.url);
      token = url.searchParams.get("token")?.trim() ?? "";
    } catch {
      token = "";
    }
  }
  if (!token) throw new CliAuthError("Missing bearer token");

  const hash = createHash("sha256").update(token).digest("hex");
  const row = await lookup.findByHash(hash);

  if (!row) throw new CliAuthError("Invalid token");
  if (row.revokedAt) throw new CliAuthError("Token revoked", 403);
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    throw new CliAuthError("Token expired", 403);
  }

  await lookup.touch(row.id);

  return {
    userId: row.userId,
    stateId: row.stateId,
    scopes: row.scopes,
    tokenId: row.id,
  };
}

export function requireScope(ctx: CliAuthContext, required: string): void {
  if (ctx.scopes.includes("*")) return;
  if (ctx.scopes.includes(required)) return;
  // wildcard in domain: "vertical.*" grants "vertical.write".
  const [domain] = required.split(".");
  if (domain && ctx.scopes.includes(`${domain}.*`)) return;

  throw new CliAuthError(`Scope "${required}" is required`, 403);
}
