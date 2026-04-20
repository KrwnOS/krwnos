/**
 * POST /api/state/sovereign-onboarding/complete
 *
 * Idempotent: marks the current user as having finished the sovereign
 * first-run tour. Stored in `StateSettings.extras` (merged, not replaced
 * wholesale except for the onboarding map key).
 *
 * Auth: Sovereign (`isOwner`) or `state.configure`.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  markSovereignOnboardingComplete,
  isSovereignOnboardingComplete,
} from "@/core/sovereign-onboarding";
import { StateConfigPermissions } from "@/core/state-config";
import {
  loadStateContext,
  serialiseForWire,
  stateErrorResponse,
} from "../../_context";

function canComplete(access: {
  isOwner: boolean;
  permissions: ReadonlySet<string>;
}): boolean {
  if (access.isOwner) return true;
  return access.permissions.has(StateConfigPermissions.Configure);
}

export async function POST(req: NextRequest) {
  try {
    const { stateId, service, access } = await loadStateContext(req);
    if (!canComplete(access)) {
      return NextResponse.json(
        { error: "Forbidden.", code: "forbidden" },
        { status: 403 },
      );
    }

    const current = await service.get(stateId);
    const extras = current.extras as Record<string, unknown> | undefined;
    if (isSovereignOnboardingComplete(extras, access.userId)) {
      return NextResponse.json({
        ok: true,
        already: true,
        settings: serialiseForWire(current),
      });
    }

    const nextExtras = markSovereignOnboardingComplete(extras, access.userId);
    const settings = await service.update(stateId, access, { extras: nextExtras });
    return NextResponse.json({ ok: true, settings: serialiseForWire(settings) });
  } catch (err) {
    return stateErrorResponse(err);
  }
}
