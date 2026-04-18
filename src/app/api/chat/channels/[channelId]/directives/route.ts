/**
 * POST /api/chat/channels/:channelId/directives
 *   — issue a "Системный приказ" (Directive).
 *
 * Requires:
 *   * CLI scope `chat.write`.
 *   * The sender must sit STRICTLY ABOVE the channel's bound node in
 *     the Vertical (or be the Sovereign). Enforced by
 *     `ChatService.canPostDirective`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireScope } from "../../../../cli/auth";
import { loadChatContext, chatErrorResponse } from "../../../_context";

const postSchema = z.object({
  body: z.string().min(1).max(8000),
  metadata: z.record(z.unknown()).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { channelId: string } },
) {
  try {
    const { cli, service, access } = await loadChatContext(req);
    requireScope(cli, "chat.write");

    const payload = postSchema.parse(await req.json());
    const message = await service.postDirective(
      params.channelId,
      access,
      payload,
    );
    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    return chatErrorResponse(err);
  }
}
