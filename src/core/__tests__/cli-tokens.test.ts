/**
 * Unit tests for `CliTokenService` (`src/core/cli-tokens.ts`).
 *
 * Ядро контракта:
 *   * `mint()` возвращает plaintext один раз, БД получает только hash.
 *   * `rotate()` наследует scopes/stateId/expiry и отзывает исходный.
 *   * `revoke()` идемпотентен; второй вызов — no-op.
 *   * Валидация label / scopes — строгая.
 */

import { describe, expect, it } from "vitest";
import {
  CliTokenService,
  type CliTokenRepository,
  type CliTokenRow,
} from "../cli-tokens";

class MemRepo implements CliTokenRepository {
  rows = new Map<string, CliTokenRow>();
  byHash = new Map<string, string>();
  private seq = 0;

  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }

  async findByHash(hash: string) {
    const id = this.byHash.get(hash);
    return id ? (this.rows.get(id) ?? null) : null;
  }

  async insert(row: {
    userId: string;
    stateId: string | null;
    tokenHash: string;
    label: string;
    scopes: string[];
    expiresAt: Date | null;
  }): Promise<CliTokenRow> {
    const id = `kt_${++this.seq}`;
    const created: CliTokenRow = {
      id,
      userId: row.userId,
      stateId: row.stateId,
      label: row.label,
      scopes: row.scopes,
      createdAt: new Date(),
      lastUsedAt: null,
      expiresAt: row.expiresAt,
      revokedAt: null,
    };
    this.rows.set(id, created);
    this.byHash.set(row.tokenHash, id);
    return created;
  }

  async revoke(id: string, at: Date): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    this.rows.set(id, { ...row, revokedAt: at });
  }
}

describe("CliTokenService.mint", () => {
  it("returns a kt_-prefixed plaintext token and stores only its hash", async () => {
    const repo = new MemRepo();
    const svc = new CliTokenService(repo);
    const res = await svc.mint({
      userId: "u1",
      stateId: "s1",
      label: "ops",
      scopes: ["wallet.read", "wallet.write"],
      ttlMs: 10 * 60_000,
    });
    expect(res.token.startsWith("kt_")).toBe(true);
    expect(res.row.label).toBe("ops");
    expect(res.row.scopes).toEqual(["wallet.read", "wallet.write"]);
    expect(res.row.expiresAt).toBeInstanceOf(Date);

    const resolved = await svc.resolve(res.token);
    expect(resolved?.id).toBe(res.id);
  });

  it("supports ttl-less tokens", async () => {
    const repo = new MemRepo();
    const svc = new CliTokenService(repo);
    const res = await svc.mint({
      userId: "u1",
      stateId: null,
      label: "forever",
      scopes: ["*"],
    });
    expect(res.row.expiresAt).toBeNull();
    expect(res.row.stateId).toBeNull();
  });

  it("rejects empty labels", async () => {
    const svc = new CliTokenService(new MemRepo());
    await expect(
      svc.mint({ userId: "u", stateId: null, label: "   ", scopes: ["*"] }),
    ).rejects.toThrow(/label is required/);
  });

  it("rejects labels > 64 chars", async () => {
    const svc = new CliTokenService(new MemRepo());
    await expect(
      svc.mint({
        userId: "u",
        stateId: null,
        label: "x".repeat(65),
        scopes: ["*"],
      }),
    ).rejects.toThrow(/≤ 64/);
  });

  it("rejects empty scopes array", async () => {
    const svc = new CliTokenService(new MemRepo());
    await expect(
      svc.mint({ userId: "u", stateId: null, label: "t", scopes: [] }),
    ).rejects.toThrow(/At least one scope/);
  });

  it("rejects malformed scope strings", async () => {
    const svc = new CliTokenService(new MemRepo());
    await expect(
      svc.mint({
        userId: "u",
        stateId: null,
        label: "t",
        scopes: ["WALLET.READ"],
      }),
    ).rejects.toThrow(/Invalid scope/);
    await expect(
      svc.mint({ userId: "u", stateId: null, label: "t", scopes: ["wallet"] }),
    ).rejects.toThrow(/Invalid scope/);
  });
});

describe("CliTokenService.rotate", () => {
  it("mints a replacement with inherited metadata and revokes the source", async () => {
    const repo = new MemRepo();
    const svc = new CliTokenService(repo);
    const first = await svc.mint({
      userId: "u1",
      stateId: "s1",
      label: "ops",
      scopes: ["wallet.read"],
      ttlMs: 120_000,
    });
    const rotated = await svc.rotate({ currentTokenId: first.id });
    expect(rotated.revokedTokenId).toBe(first.id);
    expect(rotated.token.startsWith("kt_")).toBe(true);
    expect(rotated.row.scopes).toEqual(["wallet.read"]);
    expect(rotated.row.stateId).toBe("s1");
    expect(rotated.row.label).toMatch(/rotated \(\d{4}-\d{2}-\d{2}\)$/);
    expect(repo.rows.get(first.id)?.revokedAt).toBeInstanceOf(Date);
  });

  it("accepts explicit overrides", async () => {
    const repo = new MemRepo();
    const svc = new CliTokenService(repo);
    const first = await svc.mint({
      userId: "u1",
      stateId: "s1",
      label: "a",
      scopes: ["wallet.read"],
    });
    const rotated = await svc.rotate({
      currentTokenId: first.id,
      label: "hand-cranked",
      scopes: ["wallet.*", "*"],
      ttlMs: 60_000,
    });
    expect(rotated.row.label).toBe("hand-cranked");
    expect(rotated.row.scopes).toEqual(["wallet.*", "*"]);
    expect(rotated.row.expiresAt).toBeInstanceOf(Date);
  });

  it("passing ttlMs=null explicitly produces a non-expiring token", async () => {
    const repo = new MemRepo();
    const svc = new CliTokenService(repo);
    const first = await svc.mint({
      userId: "u1",
      stateId: null,
      label: "a",
      scopes: ["*"],
      ttlMs: 60_000,
    });
    const rotated = await svc.rotate({
      currentTokenId: first.id,
      ttlMs: null,
    });
    expect(rotated.row.expiresAt).toBeNull();
  });

  it("throws when source is missing", async () => {
    const svc = new CliTokenService(new MemRepo());
    await expect(svc.rotate({ currentTokenId: "nope" })).rejects.toThrow(
      /not found/,
    );
  });

  it("throws when source is already revoked", async () => {
    const repo = new MemRepo();
    const svc = new CliTokenService(repo);
    const first = await svc.mint({
      userId: "u1",
      stateId: null,
      label: "a",
      scopes: ["*"],
    });
    await svc.revoke(first.id);
    await expect(svc.rotate({ currentTokenId: first.id })).rejects.toThrow(
      /already revoked/,
    );
  });
});

describe("CliTokenService.revoke", () => {
  it("is idempotent", async () => {
    const repo = new MemRepo();
    const svc = new CliTokenService(repo);
    const first = await svc.mint({
      userId: "u1",
      stateId: null,
      label: "a",
      scopes: ["*"],
    });
    await svc.revoke(first.id);
    await svc.revoke(first.id);
    expect(repo.rows.get(first.id)?.revokedAt).toBeInstanceOf(Date);
  });

  it("throws when id is unknown", async () => {
    const svc = new CliTokenService(new MemRepo());
    await expect(svc.revoke("missing")).rejects.toThrow(/not found/);
  });
});

describe("CliTokenService.resolve", () => {
  it("returns null for unknown plaintext", async () => {
    const svc = new CliTokenService(new MemRepo());
    expect(await svc.resolve("kt_unknown")).toBeNull();
  });
});
