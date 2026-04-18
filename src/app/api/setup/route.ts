/**
 * GET  /api/setup  → { initialised: boolean }
 * POST /api/setup  → runs first-time bootstrap (idempotent, one-shot).
 *
 * This endpoint backs the web wizard at `/setup`. It is intentionally
 * unauthenticated — first-run, by definition, has no accounts yet.
 * A hard DB check (`state.count() > 0`) prevents any post-bootstrap
 * re-invocation.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { setupState, AlreadyInitialisedError } from "@/core/setup-state";

export const dynamic = "force-dynamic";

const body = z.object({
  stateName: z.string().min(2).max(80),
  stateSlug: z.string().min(2).max(48).optional(),
  stateDescription: z.string().max(500).optional(),
  ownerHandle: z.string().min(3).max(32),
  ownerDisplayName: z.string().max(80).optional(),
  ownerEmail: z.string().email().optional(),
});

export async function GET() {
  const count = await prisma.state.count();
  return NextResponse.json({ initialised: count > 0 });
}

export async function POST(req: NextRequest) {
  try {
    const parsed = body.parse(await req.json());
    const result = await setupState(parsed);

    return NextResponse.json(
      {
        stateId: result.stateId,
        stateSlug: result.stateSlug,
        sovereignNodeId: result.sovereignNodeId,
        userId: result.userId,
        cliToken: result.cliToken,
        cliTokenId: result.cliTokenId,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof AlreadyInitialisedError) {
      return NextResponse.json(
        { error: "already_initialised", message: err.message },
        { status: 409 },
      );
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_failed", issues: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error: "setup_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }
}
