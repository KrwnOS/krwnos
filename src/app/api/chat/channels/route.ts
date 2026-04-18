/**
 * GET  /api/chat/channels  — list channels the caller can read
 * POST /api/chat/channels  — create a new channel (chat.admin)
 *
 * Thin adapter: auth & deserialisation here, all logic in ChatService.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireScope } from "../../cli/auth";
import { loadChatContext, chatErrorResponse } from "../_context";

const createSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-_]*$/, "lowercase alnum, -, _ only"),
  title: z.string().min(1).max(120),
  topic: z.string().max(500).optional(),
  nodeId: z.string().nullable().optional(),
  visibility: z.enum(["public", "private"]).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const { cli, stateId, service, access } = await loadChatContext(req);
    requireScope(cli, "chat.read");

    const channels = await service.listReadableChannels(stateId, access);
    return NextResponse.json({
      channels,
      me: { userId: access.userId, isOwner: access.isOwner },
    });
  } catch (err) {
    return chatErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { cli, stateId, service, access } = await loadChatContext(req);
    requireScope(cli, "chat.admin");

    const body = createSchema.parse(await req.json());
    const channel = await service.createChannel(stateId, access, body);
    return NextResponse.json({ channel }, { status: 201 });
  } catch (err) {
    return chatErrorResponse(err);
  }
}
