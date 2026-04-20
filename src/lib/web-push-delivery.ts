/**
 * Server-side Web Push delivery (VAPID). Requires env from `docs/DEPLOYMENT.md`.
 * When VAPID is missing, handlers no-op so local/dev without keys stays quiet.
 */
import type { PrismaClient, WebPushSubscription } from "@prisma/client";
import webpush from "web-push";
import { logger } from "@/lib/logger";

export interface WebPushPayload {
  title: string;
  body: string;
  data?: { url?: string; kind?: string; [k: string]: unknown };
}

export type PushSubscriptionJSON = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export function isWebPushConfigured(): boolean {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  return Boolean(pub && priv && subject);
}

let vapidApplied = false;

function ensureVapidDetails(): void {
  if (vapidApplied) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) {
    throw new Error("VAPID keys or subject missing");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidApplied = true;
}

function readStatusCode(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const sc = (err as { statusCode?: number }).statusCode;
  return typeof sc === "number" ? sc : undefined;
}

/**
 * Serialize notification for `public/sw.js` → push event → showNotification.
 */
function encodePayload(p: WebPushPayload): string {
  return JSON.stringify({
    title: p.title,
    body: p.body,
    data: p.data ?? {},
  });
}

export async function deliverWebPushToRows(
  prisma: PrismaClient,
  rows: WebPushSubscription[],
  payload: WebPushPayload,
): Promise<void> {
  if (!rows.length) return;
  if (!isWebPushConfigured()) return;
  try {
    ensureVapidDetails();
  } catch (err) {
    logger.warn({ err }, "web_push: VAPID not configured");
    return;
  }

  const body = encodePayload(payload);

  for (const row of rows) {
    const sub = row.subscription as unknown as PushSubscriptionJSON;
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      await prisma.webPushSubscription.delete({ where: { id: row.id } }).catch(
        () => undefined,
      );
      continue;
    }

    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.keys.p256dh,
            auth: sub.keys.auth,
          },
        },
        body,
        { TTL: 3600 },
      );
    } catch (err) {
      const code = readStatusCode(err);
      if (code === 410) {
        await prisma.webPushSubscription.delete({ where: { id: row.id } }).catch(
          () => undefined,
        );
        logger.info({ id: row.id }, "web_push: subscription gone (410), removed");
      } else {
        logger.warn({ err, subscriptionId: row.id, statusCode: code }, "web_push: send failed");
      }
    }
  }
}

function truncateBody(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Notify the directive issuer that a subordinate acknowledged. */
export async function notifyDirectiveAcknowledged(
  prisma: PrismaClient,
  args: {
    stateId: string;
    messageId: string;
    ackUserId: string;
  },
): Promise<void> {
  const msg = await prisma.chatMessage.findUnique({
    where: { id: args.messageId },
    select: { authorId: true, body: true, isDirective: true },
  });
  if (!msg?.isDirective) return;
  const issuerId = msg.authorId;
  if (issuerId === args.ackUserId) return;

  const subs = await prisma.webPushSubscription.findMany({
    where: {
      stateId: args.stateId,
      userId: issuerId,
      notifyDirectiveAcks: true,
    },
  });

  await deliverWebPushToRows(prisma, subs, {
    title: "Directive acknowledged",
    body: `Your directive was marked received.${msg.body ? ` «${truncateBody(msg.body, 90)}»` : ""}`,
    data: {
      kind: "chat.directive_ack",
      url: "/dashboard",
      messageId: args.messageId,
    },
  });
}

/** Notify the proposal author when someone else casts a vote. */
export async function notifyProposalVoteCast(
  prisma: PrismaClient,
  args: {
    stateId: string;
    proposalId: string;
    voterUserId: string;
    choice: string;
  },
): Promise<void> {
  const proposal = await prisma.proposal.findUnique({
    where: { id: args.proposalId },
    select: { createdById: true, stateId: true, targetConfigKey: true },
  });
  if (!proposal || proposal.stateId !== args.stateId) return;
  if (proposal.createdById === args.voterUserId) return;

  const subs = await prisma.webPushSubscription.findMany({
    where: {
      stateId: args.stateId,
      userId: proposal.createdById,
      notifyProposalVotes: true,
    },
  });

  await deliverWebPushToRows(prisma, subs, {
    title: "New vote on proposal",
    body: `Vote: ${args.choice} · ${proposal.targetConfigKey}`,
    data: {
      kind: "governance.vote_cast",
      url: "/governance",
      proposalId: args.proposalId,
    },
  });
}
