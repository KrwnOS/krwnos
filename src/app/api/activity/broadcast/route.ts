/**
 * POST /api/activity/broadcast — Суверенский указ / широковещание.
 * ------------------------------------------------------------
 * Ставит в «Пульс Государства» особую строку, которую клиент
 * распознаёт как **push-событие**: SSE-слушатели на
 * `/api/activity/stream` увидят её мгновенно и поднимут toast
 * (плюс, если пользователь разрешил — нативный Web Notification).
 *
 * Отличия от обычной записи ленты:
 *   * `event = "core.broadcast.sovereign"` — канонический тэг,
 *     по которому UI фильтрует «высокоприоритетные» сообщения.
 *   * `metadata.priority = "high"` и `metadata.broadcast = true`
 *     (двойной флаг для forward-совместимости: если кто-то будет
 *     слушать без знания имени события — флага в metadata хватит).
 *   * `visibility` — задаётся автором, но по умолчанию `public`
 *     (указ адресован всему государству).
 *
 * Аутентификация — CLI bearer token. Authorization: либо Суверен
 * (owner), либо держатель `system.admin` / `*`. Все остальные
 * получают 403 — широковещать без мандата нельзя.
 *
 * Broadcast — это запись в `ActivityLog`, а НЕ отдельная очередь:
 * историю указов можно поднять тем же GET-ом с `event=...`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { loadStateContext, stateErrorResponse } from "../../state/_context";
import { getActivityFeed } from "@/server/activity-boot";
import type { PermissionKey } from "@/types/kernel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BROADCAST_EVENT = "core.broadcast.sovereign";
const BROADCAST_PERMISSION: PermissionKey = "system.admin";

const bodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  /** Опциональное длинное тело. UI покажет toast с title; body — ниже. */
  body: z.string().trim().max(2000).optional(),
  /**
   * Ограничить адресатов одним узлом (и его потомками —
   * ActivityFeedService сам обработает visibility=node). Полезно,
   * если Суверен объявляет приказ только одному министерству.
   */
  nodeId: z.string().trim().min(1).nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { stateId, access } = await loadStateContext(req);

    const canBroadcast =
      access.isOwner ||
      access.permissions.has("*") ||
      access.permissions.has(BROADCAST_PERMISSION) ||
      access.permissions.has("system.*" as PermissionKey);

    if (!canBroadcast) {
      return NextResponse.json(
        {
          error:
            "Broadcast может объявлять только Суверен или держатель system.admin.",
          code: "forbidden",
        },
        { status: 403 },
      );
    }

    const payload = bodySchema.parse(await req.json());

    const service = getActivityFeed();
    const entry = await service.record({
      stateId,
      event: BROADCAST_EVENT,
      category: "state",
      titleKey: "pulse.event.broadcast.sovereign",
      titleParams: {
        title: payload.title,
        body: payload.body ?? "",
      },
      actorId: access.userId,
      nodeId: payload.nodeId ?? null,
      visibility: payload.nodeId ? "node" : "public",
      metadata: {
        // Двойной флаг: короткое имя события + явный маркер в
        // metadata. SSE-клиент проверяет оба.
        broadcast: true,
        priority: "high",
        title: payload.title,
        body: payload.body ?? "",
      },
    });

    if (!entry) {
      return NextResponse.json(
        { error: "Failed to record broadcast", code: "internal" },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        entry: {
          ...entry,
          createdAt: entry.createdAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (err) {
    return stateErrorResponse(err);
  }
}
