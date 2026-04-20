/**
 * Pure aggregation helpers for email digest content.
 * Pulse uses the same visibility rules as `ActivityFeedService` / `isActivityEntryVisibleToViewer`.
 *
 * Chat «mentions»: optional block counts messages whose body contains `@handle`
 * (case-insensitive substring) — minimal implementation; see `docs/DEPLOYMENT.md`.
 */

import type { PrismaClient } from "@prisma/client";
import type {
  ActivityLog,
  ActivityViewerContext,
  ActivityVisibility,
} from "@/core/activity-feed";
import { isActivityEntryVisibleToViewer } from "@/core/activity-feed";
import type { DigestKind } from "./email-digest-period";
import { digestTimeWindow } from "./email-digest-period";

export interface DigestPulseLine {
  stateId: string;
  category: string;
  titleKey: string;
  createdAt: Date;
}

export interface DigestProposalLine {
  id: string;
  stateId: string;
  title: string;
  expiresAt: Date;
}

export interface DigestAggregates {
  kind: DigestKind;
  window: { start: Date; end: Date };
  pulse: DigestPulseLine[];
  proposals: DigestProposalLine[];
  mentionCount: number;
}

const PULSE_CAP = 12;
const PROPOSAL_CAP = 15;

/** Exported for unit tests — clamps fetched rows before visibility filter. */
export const EMAIL_DIGEST_PULSE_FETCH_CAP = 400;

export function pickDigestSubscription(
  kind: DigestKind,
  row: {
    emailDigestDaily: boolean;
    emailDigestWeekly: boolean;
  },
): boolean {
  if (kind === "daily") return row.emailDigestDaily;
  return row.emailDigestWeekly;
}

/**
 * Filters Prisma-shaped pulse rows using the same visibility predicate as the API.
 */
export function filterVisibleActivity(
  rows: ActivityLog[],
  viewer: ActivityViewerContext,
): ActivityLog[] {
  return rows.filter((r) => isActivityEntryVisibleToViewer(r, viewer));
}

export function toDigestPulseLines(rows: ActivityLog[]): DigestPulseLine[] {
  return rows.map((r) => ({
    stateId: r.stateId,
    category: r.category,
    titleKey: r.titleKey,
    createdAt: r.createdAt,
  }));
}

function normaliseVisibility(value: string): ActivityVisibility {
  switch (value) {
    case "public":
    case "node":
    case "audience":
    case "sovereign":
      return value;
    default:
      return "public";
  }
}

/**
 * Loads vertical nodes for `stateId`, builds `scopeNodeIds` (member nodes + ancestors),
 * and returns a viewer context for Pulse visibility checks.
 */
export async function buildActivityViewerForState(
  prisma: PrismaClient,
  stateId: string,
  userId: string,
): Promise<ActivityViewerContext | null> {
  const state = await prisma.state.findUnique({
    where: { id: stateId },
    select: { ownerId: true },
  });
  if (!state) return null;

  const [nodes, memberships] = await Promise.all([
    prisma.verticalNode.findMany({
      where: { stateId },
      select: { id: true, parentId: true },
    }),
    prisma.membership.findMany({
      where: { userId, status: "active", node: { stateId } },
      select: { nodeId: true },
    }),
  ]);

  const parentOf = new Map<string, string | null>();
  for (const n of nodes) parentOf.set(n.id, n.parentId);

  const scope = new Set<string>();
  for (const m of memberships) {
    let cursor: string | null | undefined = m.nodeId;
    while (cursor) {
      if (scope.has(cursor)) break;
      scope.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
  }

  return {
    userId,
    stateId,
    isOwner: state.ownerId === userId,
    scopeNodeIds: scope,
  };
}

export async function aggregateDigestForUser(
  prisma: PrismaClient,
  opts: {
    userId: string;
    handle: string;
    kind: DigestKind;
    now: Date;
    includeChatMentions: boolean;
  },
): Promise<DigestAggregates> {
  const window = digestTimeWindow(opts.kind, opts.now);

  const memberships = await prisma.membership.findMany({
    where: { userId: opts.userId, status: "active" },
    select: { node: { select: { stateId: true } } },
  });
  const stateIds = [
    ...new Set(memberships.map((m) => m.node.stateId).filter(Boolean)),
  ];

  const pulseAccum: DigestPulseLine[] = [];
  for (const stateId of stateIds) {
    const viewer = await buildActivityViewerForState(
      prisma,
      stateId,
      opts.userId,
    );
    if (!viewer) continue;

    const rows = await prisma.activityLog.findMany({
      where: {
        stateId,
        createdAt: { gte: window.start, lte: window.end },
      },
      orderBy: { createdAt: "desc" },
      take: EMAIL_DIGEST_PULSE_FETCH_CAP,
    });

    const domain: ActivityLog[] = rows.map((r) => ({
      id: r.id,
      stateId: r.stateId,
      event: r.event,
      category: r.category,
      titleKey: r.titleKey,
      titleParams: (r.titleParams as Record<string, unknown>) ?? {},
      actorId: r.actorId,
      nodeId: r.nodeId,
      visibility: normaliseVisibility(r.visibility),
      audienceUserIds: r.audienceUserIds,
      metadata: (r.metadata as Record<string, unknown>) ?? {},
      createdAt: r.createdAt,
    }));

    const visible = filterVisibleActivity(domain, viewer);
    pulseAccum.push(...toDigestPulseLines(visible));
  }

  pulseAccum.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const trimmedPulse = pulseAccum.slice(0, PULSE_CAP);

  const proposals =
    stateIds.length === 0
      ? []
      : await prisma.proposal.findMany({
          where: {
            stateId: { in: stateIds },
            status: "active",
            expiresAt: { gt: opts.now },
          },
          orderBy: { expiresAt: "asc" },
          take: PROPOSAL_CAP,
          select: {
            id: true,
            stateId: true,
            title: true,
            expiresAt: true,
          },
        });

  let mentionCount = 0;
  if (opts.includeChatMentions && stateIds.length > 0) {
    const needle = `@${opts.handle}`;
    mentionCount = await prisma.chatMessage.count({
      where: {
        createdAt: { gte: window.start, lte: window.end },
        body: { contains: needle, mode: "insensitive" },
        channel: { stateId: { in: stateIds } },
      },
    });
  }

  return {
    kind: opts.kind,
    window,
    pulse: trimmedPulse,
    proposals,
    mentionCount,
  };
}
