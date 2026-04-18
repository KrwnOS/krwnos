/**
 * GET  /api/chat/channels/:channelId/messages  — recent messages
 * POST /api/chat/channels/:channelId/messages  — send a message
 *
 * Permission gates enforced by ChatService:
 *   * GET  requires `chat.read`  + channel access (node membership
 *                                  for node-bound channels).
 *   * POST requires `chat.write` + channel access.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireScope } from "../../../../cli/auth";
import { loadChatContext, chatErrorResponse } from "../../../_context";

const postSchema = z.object({
  body: z.string().min(1).max(8000),
  metadata: z.record(z.unknown()).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { channelId: string } },
) {
  try {
    const { cli, service, access } = await loadChatContext(req);
    requireScope(cli, "chat.read");

    const url = new URL(req.url);
    const limit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
    const beforeParam = url.searchParams.get("before");
    const before = beforeParam ? new Date(beforeParam) : null;

    const messages = await service.listMessages(params.channelId, access, {
      limit: Number.isFinite(limit) ? limit : 50,
      before,
    });
    return NextResponse.json({ messages });
  } catch (err) {
    return chatErrorResponse(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { channelId: string } },
) {
  try {
    const { cli, service, access } = await loadChatContext(req);
    requireScope(cli, "chat.write");

    const payload = postSchema.parse(await req.json());
    const message = await service.postMessage(params.channelId, access, payload);
    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    return chatErrorResponse(err);
  }
}
