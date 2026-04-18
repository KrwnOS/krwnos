/**
 * GET /api/chat/directives/pending
 *   — returns directives the current user still has to acknowledge,
 *     plus the originating channel and message. The UI uses this to
 *     render the persistent "Требует вашего подтверждения" tray.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireScope } from "../../../cli/auth";
import { loadChatContext, chatErrorResponse } from "../../_context";

export async function GET(req: NextRequest) {
  try {
    const { cli, service, access } = await loadChatContext(req);
    requireScope(cli, "chat.read");

    const pending = await service.listPendingDirectives(access);
    return NextResponse.json({ pending });
  } catch (err) {
    return chatErrorResponse(err);
  }
}
