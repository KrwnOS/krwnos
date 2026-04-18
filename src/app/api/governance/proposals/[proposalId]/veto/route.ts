/**
 * `POST /api/governance/proposals/[proposalId]/veto`
 *
 * Вето Суверена. Возможно в статусах `active` и `passed`, но не
 * после `executed`. Тело:
 *   { reason?: string }
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  governanceErrorResponse,
  loadGovernanceContext,
  serialiseForWire,
} from "../../../_context";

const VetoSchema = z
  .object({
    reason: z.string().max(2000).optional().nullable(),
  })
  .strict()
  .optional();

export async function POST(
  req: NextRequest,
  { params }: { params: { proposalId: string } },
) {
  try {
    const { service, access } = await loadGovernanceContext(req);
    let body: { reason?: string | null } | undefined;
    try {
      body = VetoSchema.parse(await req.json());
    } catch {
      // Пустое тело допустимо — вето без причины.
      body = undefined;
    }
    const proposal = await service.veto(params.proposalId, access, {
      reason: body?.reason ?? null,
    });
    return NextResponse.json({ proposal: serialiseForWire(proposal) });
  } catch (err) {
    return governanceErrorResponse(err);
  }
}
