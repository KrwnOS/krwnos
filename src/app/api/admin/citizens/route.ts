/**
 * GET  /api/admin/citizens — list memberships with filters.
 * POST /api/admin/citizens — citizen admin actions (kick, ban, …).
 *
 * Auth: CLI bearer; screen access via `canAccessCitizensAdminScreen`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { canAccessCitizensAdminScreen } from "@/core/citizens-admin-logic";
import {
  admitUser,
  banUser,
  CitizensAdminError,
  kickMembership,
  listCitizens,
  mergeUsers,
  moveMembership,
  unbanUser,
  updateMembershipTitle,
} from "@/server/citizens-admin-service";
import {
  loadStateContext,
  stateErrorResponse,
} from "../../state/_context";

export const dynamic = "force-dynamic";

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("kick"),
    userId: z.string().min(1),
    nodeId: z.string().min(1),
  }),
  z.object({
    action: z.literal("ban"),
    userId: z.string().min(1),
    reason: z.string().max(500).optional().nullable(),
  }),
  z.object({
    action: z.literal("unban"),
    userId: z.string().min(1),
  }),
  z.object({
    action: z.literal("move"),
    userId: z.string().min(1),
    fromNodeId: z.string().min(1),
    toNodeId: z.string().min(1),
    title: z.string().max(80).optional().nullable(),
  }),
  z.object({
    action: z.literal("admit"),
    userId: z.string().min(1),
    targetNodeId: z.string().min(1),
    title: z.string().max(80).optional().nullable(),
  }),
  z.object({
    action: z.literal("editTitle"),
    userId: z.string().min(1),
    nodeId: z.string().min(1),
    title: z.string().max(80).nullable(),
  }),
  z.object({
    action: z.literal("merge"),
    sourceUserId: z.string().min(1),
    targetUserId: z.string().min(1),
  }),
]);

export async function GET(req: NextRequest) {
  try {
    const { stateId, access, snapshot } = await loadStateContext(req);
    if (!canAccessCitizensAdminScreen(stateId, access, snapshot)) {
      return forbidden();
    }

    const { searchParams } = new URL(req.url);
    const nodeId = searchParams.get("nodeId") ?? undefined;
    const statusRaw = searchParams.get("status");
    const status =
      statusRaw === "active" || statusRaw === "pending" || statusRaw === "all"
        ? statusRaw
        : "all";
    const q = searchParams.get("q") ?? undefined;
    const limit = searchParams.get("limit")
      ? Number(searchParams.get("limit"))
      : undefined;

    const rows = await listCitizens({
      stateId,
      nodeId: nodeId || null,
      status: status === "all" ? "all" : status,
      q,
      limit,
    });

    return NextResponse.json({ rows });
  } catch (err) {
    return stateErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { stateId, access, snapshot } = await loadStateContext(req);
    if (!canAccessCitizensAdminScreen(stateId, access, snapshot)) {
      return forbidden();
    }

    const parsed = postSchema.parse(await req.json());
    const base = { stateId, access, snapshot };

    switch (parsed.action) {
      case "kick":
        await kickMembership({
          ...base,
          userId: parsed.userId,
          nodeId: parsed.nodeId,
        });
        break;
      case "ban":
        await banUser({
          ...base,
          userId: parsed.userId,
          reason: parsed.reason,
        });
        break;
      case "unban":
        await unbanUser({ ...base, userId: parsed.userId });
        break;
      case "move":
        await moveMembership({
          ...base,
          userId: parsed.userId,
          fromNodeId: parsed.fromNodeId,
          toNodeId: parsed.toNodeId,
          title: parsed.title,
        });
        break;
      case "admit":
        await admitUser({
          ...base,
          userId: parsed.userId,
          targetNodeId: parsed.targetNodeId,
          title: parsed.title,
        });
        break;
      case "editTitle":
        await updateMembershipTitle({
          ...base,
          userId: parsed.userId,
          nodeId: parsed.nodeId,
          title: parsed.title,
        });
        break;
      case "merge":
        await mergeUsers({
          ...base,
          sourceUserId: parsed.sourceUserId,
          targetUserId: parsed.targetUserId,
        });
        break;
      default:
        return NextResponse.json({ error: "unknown_action" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof CitizensAdminError) {
      const status =
        err.code === "not_found"
          ? 404
          : err.code === "forbidden"
            ? 403
            : err.code === "merge_blocked"
              ? 409
              : 400;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
      );
    }
    return stateErrorResponse(err);
  }
}

function forbidden() {
  return NextResponse.json(
    {
      error:
        "Citizens admin requires the Sovereign, system.admin, or a members.* / invitations.create permission.",
      code: "forbidden",
    },
    { status: 403 },
  );
}
