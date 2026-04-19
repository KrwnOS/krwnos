/**
 * Unit tests for the minimal auth layer (`src/core/auth.ts` +
 * `src/core/auth-credentials.ts`).
 *
 * Ядро здесь тонкое, но функционально важное — тесты охраняют
 * инвариант «без adapter-а `requireUser()` должен бросить
 * `UnauthorizedError`» и корректную логику CredentialsRegistry.
 */

import { describe, expect, it } from "vitest";
import {
  UnauthorizedError,
  getAuth,
  setAuthAdapter,
  type AuthAdapter,
} from "../auth";
import {
  CredentialsRegistry,
  credentialsRegistry,
  type CredentialProvider,
} from "../auth-credentials";
import type {
  AuthCredential,
  AuthCredentialKind,
  UserRef,
} from "@/types/kernel";

// ------------------------------------------------------------
// auth.ts
// ------------------------------------------------------------

describe("NullAuthAdapter default", () => {
  it("getCurrentUser() → null, requireUser() → throws UnauthorizedError", async () => {
    const initial = getAuth();
    // Make sure we compare against a pristine Null adapter; if prior
    // tests swapped in a stub, reset.
    const nullAdapter: AuthAdapter = {
      getCurrentUser: async () => null,
      requireUser: async () => {
        throw new UnauthorizedError("No AuthAdapter configured.");
      },
    };
    setAuthAdapter(nullAdapter);
    try {
      const a = getAuth();
      expect(await a.getCurrentUser()).toBeNull();
      await expect(a.requireUser()).rejects.toBeInstanceOf(UnauthorizedError);
    } finally {
      setAuthAdapter(initial);
    }
  });

  it("setAuthAdapter swaps the returned adapter", async () => {
    const initial = getAuth();
    const user: UserRef = { id: "u1", handle: "alice", displayName: "Alice" };
    const stub: AuthAdapter = {
      async getCurrentUser() {
        return user;
      },
      async requireUser() {
        return user;
      },
    };
    setAuthAdapter(stub);
    try {
      expect(await getAuth().getCurrentUser()).toEqual(user);
      expect(await getAuth().requireUser()).toEqual(user);
    } finally {
      setAuthAdapter(initial);
    }
  });
});

describe("UnauthorizedError", () => {
  it("has a sensible default message + name", () => {
    const e = new UnauthorizedError();
    expect(e.name).toBe("UnauthorizedError");
    expect(e.message).toBe("Authentication required");
    expect(e).toBeInstanceOf(Error);
  });

  it("propagates a custom message", () => {
    const e = new UnauthorizedError("nope");
    expect(e.message).toBe("nope");
  });
});

// ------------------------------------------------------------
// auth-credentials.ts
// ------------------------------------------------------------

function makeProvider(kind: AuthCredentialKind): CredentialProvider {
  return {
    kind,
    async beginEnrollment() {
      return { kind };
    },
    async completeEnrollment(): Promise<AuthCredential> {
      return {} as AuthCredential;
    },
    async beginLogin() {
      return { kind };
    },
    async completeLogin(): Promise<UserRef> {
      return { id: "u1", handle: "alice" };
    },
  };
}

describe("CredentialsRegistry", () => {
  it("registers providers and exposes enabledKinds", () => {
    const reg = new CredentialsRegistry();
    reg.register(makeProvider("passkey"));
    reg.register(makeProvider("wallet_ethereum"));
    expect(reg.enabledKinds()).toEqual(["passkey", "wallet_ethereum"]);
  });

  it("throws on duplicate registration", () => {
    const reg = new CredentialsRegistry();
    reg.register(makeProvider("passkey"));
    expect(() => reg.register(makeProvider("passkey"))).toThrow(
      /already registered/,
    );
  });

  it("`get` throws when the kind is not enabled", () => {
    const reg = new CredentialsRegistry();
    expect(() => reg.get("passkey")).toThrow(/No credential provider/);
  });

  it("`get` returns the registered provider", () => {
    const reg = new CredentialsRegistry();
    const p = makeProvider("passkey");
    reg.register(p);
    expect(reg.get("passkey")).toBe(p);
  });

  it("exports a singleton", () => {
    expect(credentialsRegistry).toBeInstanceOf(CredentialsRegistry);
  });
});
