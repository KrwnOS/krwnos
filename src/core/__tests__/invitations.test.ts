/**
 * Unit tests for `InvitationsService` (`src/core/invitations.ts`).
 */

import { describe, expect, it } from "vitest";
import {
  InvitationPermissions,
  InvitationTokenError,
  InvitationsService,
  type ConsumeResult,
  type InvitationsRepository,
} from "../invitations";
import type { Invitation, UserRef } from "@/types/kernel";

type StoredInvitation = Invitation & { tokenHash: string };

class MemRepo implements InvitationsRepository {
  rows = new Map<string, StoredInvitation>();
  memberships: Array<{ userId: string; nodeId: string }> = [];

  async insert(row: {
    id: string;
    stateId: string;
    targetNodeId: string | null;
    createdById: string;
    tokenHash: string;
    code: string;
    label: string | null;
    maxUses: number;
    expiresAt: Date | null;
  }): Promise<Invitation> {
    const inv: StoredInvitation = {
      id: row.id,
      stateId: row.stateId,
      targetNodeId: row.targetNodeId,
      createdById: row.createdById,
      tokenHash: row.tokenHash,
      code: row.code,
      label: row.label,
      maxUses: row.maxUses,
      usesCount: 0,
      status: "active",
      expiresAt: row.expiresAt,
      consumedAt: null,
      createdAt: new Date(),
    };
    this.rows.set(row.id, inv);
    return inv;
  }

  async findByTokenHash(hash: string): Promise<Invitation | null> {
    for (const inv of this.rows.values()) {
      if (inv.tokenHash === hash) return inv;
    }
    return null;
  }

  async findByCode(code: string): Promise<Invitation | null> {
    for (const inv of this.rows.values()) {
      if (inv.code === code) return inv;
    }
    return null;
  }

  async updateStatus(
    id: string,
    status: Invitation["status"],
    consumedAt?: Date,
  ): Promise<void> {
    const inv = this.rows.get(id);
    if (!inv) return;
    this.rows.set(id, {
      ...inv,
      status,
      consumedAt: consumedAt ?? inv.consumedAt,
    });
  }

  async incrementUses(id: string): Promise<Invitation> {
    const inv = this.rows.get(id);
    if (!inv) throw new Error("missing");
    const next: StoredInvitation = { ...inv, usesCount: inv.usesCount + 1 };
    this.rows.set(id, next);
    return next;
  }

  async createMembership(userId: string, nodeId: string): Promise<void> {
    this.memberships.push({ userId, nodeId });
  }
}

const bob: UserRef = { id: "u_bob", handle: "bob", displayName: "Bob" };
const alice: UserRef = { id: "u_alice", handle: "alice", displayName: "Alice" };

describe("InvitationsService permissions constants", () => {
  it("exposes canonical keys", () => {
    expect(InvitationPermissions.Create).toBe("invitations.create");
    expect(InvitationPermissions.Revoke).toBe("invitations.revoke");
    expect(InvitationPermissions.View).toBe("invitations.view");
  });
});

describe("InvitationsService.create", () => {
  it("returns token + URL, stores only hash of the token", async () => {
    const repo = new MemRepo();
    const svc = new InvitationsService(repo);
    const issued = await svc.create({
      stateId: "s1",
      targetNodeId: "node_a",
      createdBy: alice,
      label: "Парламент",
      maxUses: 3,
      ttlMs: 60_000,
      origin: "https://example.com/",
    });
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(issued.url).toMatch(
      new RegExp(`^https://example.com/invite/${issued.token}$`),
    );
    const stored = repo.rows.get(issued.invitation.id)!;
    expect(stored.tokenHash).not.toBe(issued.token);
    expect(stored.tokenHash.length).toBeGreaterThan(60);
    expect(issued.invitation.label).toBe("Парламент");
    expect(issued.invitation.maxUses).toBe(3);
    expect(issued.invitation.expiresAt).not.toBeNull();
    expect(issued.invitation.code).toMatch(/^KRWN-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  });

  it("falls back to APP_URL when origin is missing", async () => {
    const repo = new MemRepo();
    const svc = new InvitationsService(repo);
    const old = process.env.APP_URL;
    process.env.APP_URL = "https://env.example";
    try {
      const issued = await svc.create({
        stateId: "s1",
        targetNodeId: null,
        createdBy: alice,
      });
      expect(issued.url.startsWith("https://env.example/invite/")).toBe(true);
      expect(issued.invitation.label).toBeNull();
      expect(issued.invitation.maxUses).toBe(1);
      expect(issued.invitation.expiresAt).toBeNull();
    } finally {
      process.env.APP_URL = old;
    }
  });

  it("falls back to localhost when APP_URL is missing", async () => {
    const repo = new MemRepo();
    const svc = new InvitationsService(repo);
    const old = process.env.APP_URL;
    delete process.env.APP_URL;
    try {
      const issued = await svc.create({
        stateId: "s1",
        targetNodeId: null,
        createdBy: alice,
      });
      expect(issued.url).toMatch(/^http:\/\/localhost:3000\/invite\//);
    } finally {
      if (old !== undefined) process.env.APP_URL = old;
    }
  });
});

// ------------------------------------------------------------
// consume()
// ------------------------------------------------------------

describe("InvitationsService.consume", () => {
  it("creates membership and marks invitation consumed on last use", async () => {
    const repo = new MemRepo();
    const svc = new InvitationsService(repo);
    const { token } = await svc.create({
      stateId: "s1",
      targetNodeId: "node_a",
      createdBy: alice,
    });

    const out: ConsumeResult = await svc.consume({ token, user: bob });
    expect(out.placedAtNodeId).toBe("node_a");
    // Service's `ConsumeResult` carries the row returned by
    // incrementUses — status is transitioned asynchronously in the
    // repo, so we assert on the repo row directly.
    expect(repo.rows.get(out.invitation.id)?.status).toBe("consumed");
    expect(repo.memberships).toEqual([{ userId: "u_bob", nodeId: "node_a" }]);
  });

  it("supports multi-use invitations", async () => {
    const repo = new MemRepo();
    const svc = new InvitationsService(repo);
    const { token } = await svc.create({
      stateId: "s1",
      targetNodeId: "node_a",
      createdBy: alice,
      maxUses: 2,
    });
    const first = await svc.consume({ token, user: bob });
    expect(first.invitation.status).toBe("active");
    const second = await svc.consume({ token, user: { ...bob, id: "u_carol" } });
    expect(repo.rows.get(second.invitation.id)?.status).toBe("consumed");
    expect(repo.memberships).toHaveLength(2);
  });

  it("rejects unknown tokens", async () => {
    const repo = new MemRepo();
    const svc = new InvitationsService(repo);
    await expect(svc.consume({ token: "nope", user: bob })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("rejects revoked tokens", async () => {
    const repo = new MemRepo();
    const svc = new InvitationsService(repo);
    const { token, invitation } = await svc.create({
      stateId: "s1",
      targetNodeId: "node_a",
      createdBy: alice,
    });
    await svc.revoke(invitation.id);
    await expect(svc.consume({ token, user: bob })).rejects.toMatchObject({
      code: "revoked",
    });
  });

  it("rejects consumed tokens", async () => {
    const repo = new MemRepo();
    const svc = new InvitationsService(repo);
    const { token } = await svc.create({
      stateId: "s1",
      targetNodeId: "node_a",
      createdBy: alice,
    });
    await svc.consume({ token, user: bob });
    await expect(svc.consume({ token, user: bob })).rejects.toMatchObject({
      code: "exhausted",
    });
  });

  it("rejects expired tokens", async () => {
    const repo = new MemRepo();
    const svc = new InvitationsService(repo);
    const { token, invitation } = await svc.create({
      stateId: "s1",
      targetNodeId: "node_a",
      createdBy: alice,
      ttlMs: 1,
    });
    // Force expiry in repo row.
    repo.rows.set(invitation.id, {
      ...invitation,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(svc.consume({ token, user: bob })).rejects.toMatchObject({
      code: "expired",
    });
  });

  it("does not create membership for global invites (null targetNodeId)", async () => {
    const repo = new MemRepo();
    const svc = new InvitationsService(repo);
    const { token } = await svc.create({
      stateId: "s1",
      targetNodeId: null,
      createdBy: alice,
    });
    const out = await svc.consume({ token, user: bob });
    expect(out.placedAtNodeId).toBeNull();
    expect(repo.memberships).toHaveLength(0);
  });
});

describe("InvitationTokenError", () => {
  it("carries the code on its instance", () => {
    const e = new InvitationTokenError("foo", "expired");
    expect(e.code).toBe("expired");
    expect(e.name).toBe("InvitationTokenError");
  });
});
