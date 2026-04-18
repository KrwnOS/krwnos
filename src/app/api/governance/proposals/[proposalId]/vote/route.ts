/**
 * `POST /api/governance/proposals/[proposalId]/vote`
 *
 * Голос гражданина. Тело:
 *   { choice: "for" | "against" | "abstain", comment?: string }
 *
 * Сервис сам выбрасывает `conflict` при повторном голосе (UI
 * должен маппить в 409).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  governanceErrorResponse,
  loadGovernanceContext,
  serialiseForWire,
} from "../../../_context";

const VoteSchema = z
  .object({
    choice: z.enum(["for", "against", "abstain"]),
    comment: z.string().max(2000).optional().nullable(),
  })
  .strict();

export async function POST(
  req: NextRequest,
  { params }: { params: { proposalId: string } },
) {
  try {
    const { service, access } = await loadGovernanceContext(req);
    const body = VoteSchema.parse(await req.json());
    const res = await service.castVote(params.proposalId, access, {
      choice: body.choice,
      comment: body.comment ?? null,
    });
    return NextResponse.json(
      {
        vote: serialiseForWire(res.vote),
        proposal: serialiseForWire(res.proposal),
      },
      { status: 201 },
    );
  } catch (err) {
    return governanceErrorResponse(err);
  }
}
