/**
 * POST /api/chat/messages/:messageId/ack
 *   — mark a directive as «Принято к исполнению» for the current user.
 *
 * Idempotent: replaying a successful ack returns the same row.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireScope } from "../../../../cli/auth";
import { loadChatContext, chatErrorResponse } from "../../../_context";

export async function POST(
  req: NextRequest,
  { params }: { params: { messageId: string } },
) {
  try {
    const { cli, service, access } = await loadChatContext(req);
    requireScope(cli, "chat.read");

    const ack = await service.acknowledgeDirective(params.messageId, access);
    return NextResponse.json({ ack });
  } catch (err) {
    return chatErrorResponse(err);
  }
}
