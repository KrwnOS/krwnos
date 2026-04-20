/**
 * Web Push delivery: mocked `web-push` provider, no real network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn() },
}));

import webpush from "web-push";
import {
  deliverWebPushToRows,
  notifyDirectiveAcknowledged,
  notifyProposalVoteCast,
} from "@/lib/web-push-delivery";

describe("web-push-delivery (mocked provider)", () => {
  const send = webpush.sendNotification as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY =
      "BMtest0123456789012345678901234567890123456789012345678901234567";
    process.env.VAPID_PRIVATE_KEY =
      "xtest01234567890123456789012345678901234567890123456789012";
    process.env.VAPID_SUBJECT = "mailto:ops@example.com";
  });

  it("deliverWebPushToRows invokes sendNotification per subscription", async () => {
    const prisma = { webPushSubscription: { delete: vi.fn() } };
    const rows = [
      {
        id: "sub-1",
        subscription: {
          endpoint: "https://example.com/push",
          keys: { p256dh: "p", auth: "a" },
        },
      },
    ];
    await deliverWebPushToRows(prisma as never, rows as never, {
      title: "T",
      body: "B",
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("notifyDirectiveAcknowledged targets directive author subscriptions", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      chatMessage: {
        findUnique: vi.fn().mockResolvedValue({
          authorId: "issuer",
          body: "do the thing",
          isDirective: true,
        }),
      },
      webPushSubscription: { findMany },
    };
    await notifyDirectiveAcknowledged(prisma as never, {
      stateId: "st1",
      messageId: "m1",
      ackUserId: "ack1",
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          stateId: "st1",
          userId: "issuer",
          notifyDirectiveAcks: true,
        }),
      }),
    );
  });

  it("notifyProposalVoteCast targets proposal author", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      proposal: {
        findUnique: vi.fn().mockResolvedValue({
          createdById: "author1",
          stateId: "st1",
          targetConfigKey: "transactionTaxRate",
        }),
      },
      webPushSubscription: { findMany },
    };
    await notifyProposalVoteCast(prisma as never, {
      stateId: "st1",
      proposalId: "p1",
      voterUserId: "voter1",
      choice: "for",
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "author1",
          notifyProposalVotes: true,
        }),
      }),
    );
  });
});
