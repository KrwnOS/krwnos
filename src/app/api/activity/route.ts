/**
 * GET /api/activity
 *
 * Возвращает отфильтрованный хвост «Пульса Государства» для
 * текущего пользователя. Query:
 *   * `limit`    — сколько строк вернуть (по умолчанию 50, max 200).
 *   * `before`   — ISO-строка, отдаём только события, созданные
 *                  ДО этой метки (для infinite scroll).
 *   * `category` — опциональный тэг: wallet / chat / governance / …
 *   * `audit=1`  — полный журнал без фильтра видимости (только Суверен /
 *                  `system.admin`). Ретенция по дате (`KRWN_ACTIVITY_LOG_RETENTION_DAYS`)
 *                  применяется всегда.
 *
 * Без `audit=1` каждая строка отфильтрована по `visibility` через
 * `ActivityFeedService.listForViewer()`.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  getActivityLogRetentionCutoff,
  getActivityLogRetentionDaysFromEnv,
} from "@/lib/activity-retention";
import {
  activityErrorResponse,
  loadActivityContext,
  serialiseEntry,
} from "./_context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await loadActivityContext(req);
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const beforeParam = url.searchParams.get("before");
    const before = beforeParam ? new Date(beforeParam) : null;
    const category = url.searchParams.get("category");

    const event = url.searchParams.get("event");
    const actorId = url.searchParams.get("actorId");

    const auditParam = url.searchParams.get("audit");
    const auditMode =
      auditParam === "1" ||
      auditParam === "true" ||
      auditParam?.toLowerCase() === "yes";
    if (auditMode && !ctx.canSeeFullAuditLog) {
      return NextResponse.json(
        {
          error:
            "Full audit log requires Sovereign or system.admin permission.",
          code: "forbidden",
        },
        { status: 403 },
      );
    }

    const viewer = {
      ...ctx.viewer,
      auditFullAccess: auditMode && ctx.canSeeFullAuditLog,
    };

    const retentionDays = getActivityLogRetentionDaysFromEnv();
    const minCreatedAt = getActivityLogRetentionCutoff();

    const entries = await ctx.service.listForViewer(viewer, {
      limit,
      before: Number.isNaN(before?.getTime()) ? null : before,
      category: category || null,
      event: event || null,
      actorId: actorId || null,
      minCreatedAt,
    });

    return NextResponse.json({
      stateId: ctx.stateId,
      auditMode,
      activityRetentionDays: retentionDays,
      viewer: {
        userId: ctx.viewer.userId,
        isOwner: ctx.viewer.isOwner,
        scopeNodeIds: [...ctx.viewer.scopeNodeIds],
      },
      entries: entries.map(serialiseEntry),
      nextBefore:
        entries.length > 0
          ? entries[entries.length - 1]!.createdAt.toISOString()
          : null,
    });
  } catch (err) {
    return activityErrorResponse(err);
  }
}
