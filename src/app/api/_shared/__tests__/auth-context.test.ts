/**
 * Contract tests for `@/app/api/_shared/auth-context`.
 *
 * Ensures the shared authentication helper correctly handles:
 * - Missing or invalid bearer tokens → 401
 * - Expired tokens → 401
 * - Valid tokens → returns populated ModuleContext with access context
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  getAuthenticatedContext,
  type AuthenticatedRouteContext,
} from "../auth-context";
import { CliAuthError } from "../../cli/auth";

// Mock the CLI auth and database layers
vi.mock("../../cli/auth", () => {
  class MockCliAuthError extends Error {
    constructor(
      override message: string,
      public status: 401 | 403,
    ) {
      super(message);
      this.name = "CliAuthError";
    }
  }
  return {
    authenticateCli: vi.fn(),
    CliAuthError: MockCliAuthError,
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cliToken: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    state: {
      findUnique: vi.fn(),
    },
    verticalNode: {
      findMany: vi.fn(),
    },
    membership: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/core", () => ({
  eventBus: { emit: vi.fn() },
  permissionsEngine: {
    resolveAll: vi.fn().mockReturnValue(new Set()),
  },
}));

vi.mock("@krwnos/sdk", () => ({
  createNoopModuleLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { authenticateCli } from "../../cli/auth";
import { prisma } from "@/lib/prisma";
import { permissionsEngine } from "@/core";
import type { PermissionKey } from "@/types/kernel";

describe("getAuthenticatedContext", () => {
  const mockRequest = {
    headers: new Headers({ authorization: "Bearer valid-token" }),
  } as unknown as NextRequest;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws 401 when bearer token is missing", async () => {
    const mockAuthCli = vi.mocked(authenticateCli);
    mockAuthCli.mockRejectedValueOnce(
      new CliAuthError("Missing bearer token", 401),
    );

    const emptyReq = {
      headers: new Headers(),
    } as unknown as NextRequest;

    await expect(getAuthenticatedContext(emptyReq)).rejects.toThrow(
      CliAuthError,
    );
    expect(mockAuthCli).toHaveBeenCalled();
  });

  it("throws 401 when token is expired", async () => {
    const mockAuthCli = vi.mocked(authenticateCli);
    mockAuthCli.mockRejectedValueOnce(
      new CliAuthError("Token expired", 401),
    );

    await expect(getAuthenticatedContext(mockRequest)).rejects.toThrow(
      CliAuthError,
    );
  });

  it("throws 401 when token is not scoped to a State", async () => {
    const mockAuthCli = vi.mocked(authenticateCli);
    mockAuthCli.mockResolvedValueOnce({
      userId: "user-123",
      stateId: null,
      scopes: ["read"],
      tokenId: "token-123",
    });

    await expect(getAuthenticatedContext(mockRequest)).rejects.toThrow(
      CliAuthError,
    );
  });

  it("throws 401 when state is not found", async () => {
    const mockAuthCli = vi.mocked(authenticateCli);
    mockAuthCli.mockResolvedValueOnce({
      userId: "user-123",
      stateId: "state-123",
      scopes: ["read"],
      tokenId: "token-123",
    });

    const mockPrismaState = vi.mocked(prisma.state);
    mockPrismaState.findUnique.mockResolvedValueOnce(null);

    await expect(getAuthenticatedContext(mockRequest)).rejects.toThrow(
      CliAuthError,
    );
  });

  it("returns populated context with valid token and state", async () => {
    const userId = "user-123";
    const stateId = "state-123";
    const permissionsToReturn: PermissionKey[] = ["read" as PermissionKey];

    const mockAuthCli = vi.mocked(authenticateCli);
    mockAuthCli.mockResolvedValueOnce({
      userId,
      stateId,
      scopes: ["read", "write"],
      tokenId: "token-123",
    });

    const mockPrismaState = vi.mocked(prisma.state);
    mockPrismaState.findUnique.mockResolvedValueOnce({
      id: stateId,
      ownerId: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      name: "Test State",
      slug: "test-state",
      description: null,
      config: {},
      themeConfig: {},
    });

    const mockPrismaNodes = vi.mocked(prisma.verticalNode);
    mockPrismaNodes.findMany.mockResolvedValueOnce([
      {
        id: "node-1",
        stateId,
        parentId: null,
        title: "Root",
        type: "position" as const,
        permissions: permissionsToReturn,
        order: 0,
        isLobby: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    ]);

    const mockPrismaMemberships = vi.mocked(prisma.membership);
    mockPrismaMemberships.findMany.mockResolvedValueOnce([
      {
        id: "membership-1",
        userId,
        nodeId: "node-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        title: null,
        status: "active",
      },
    ] as any);

    const mockPermissions = vi.mocked(permissionsEngine);
    const permSet = new Set(permissionsToReturn);
    mockPermissions.resolveAll.mockReturnValueOnce(permSet);

    const result: AuthenticatedRouteContext =
      await getAuthenticatedContext(mockRequest);

    expect(result).toBeDefined();
    expect(result.stateId).toBe(stateId);
    expect(result.cli.userId).toBe(userId);
    expect(result.ctx.userId).toBe(userId);
    expect(result.ctx.stateId).toBe(stateId);
    expect(result.access.isOwner).toBe(true);
    expect(result.access.snapshot.stateId).toBe(stateId);
    expect(result.access.snapshot.nodes.has("node-1")).toBe(true);
  });

  it("correctly sets isOwner to false when user is not the state owner", async () => {
    const userId = "user-456";
    const stateId = "state-123";
    const ownerId = "owner-789";

    const mockAuthCli = vi.mocked(authenticateCli);
    mockAuthCli.mockResolvedValueOnce({
      userId,
      stateId,
      scopes: ["read"],
      tokenId: "token-456",
    });

    const mockPrismaState = vi.mocked(prisma.state);
    mockPrismaState.findUnique.mockResolvedValueOnce({
      id: stateId,
      ownerId,
      createdAt: new Date(),
      updatedAt: new Date(),
      name: "Test State",
      slug: "test-state",
      description: null,
      config: {},
      themeConfig: {},
    });

    const mockPrismaNodes = vi.mocked(prisma.verticalNode);
    mockPrismaNodes.findMany.mockResolvedValueOnce([]);

    const mockPrismaMemberships = vi.mocked(prisma.membership);
    mockPrismaMemberships.findMany.mockResolvedValueOnce([]);

    const mockPermissions = vi.mocked(permissionsEngine);
    const permSet = new Set([] as PermissionKey[]);
    mockPermissions.resolveAll.mockReturnValueOnce(permSet);

    const result = await getAuthenticatedContext(mockRequest);

    expect(result.access.isOwner).toBe(false);
  });
});
