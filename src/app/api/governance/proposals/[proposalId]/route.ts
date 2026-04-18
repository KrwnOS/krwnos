/**
 * `/api/governance/proposals/[proposalId]`
 *
 * GET    — детали предложения: ставка кворума, текущий tally, список
 *          голосов. Лениво запускает Executor (`closeAndMaybeExecute`)
 *          если срок истёк — без cron-а голосование всё равно
 *          закроется при первом же чтении.
 * DELETE — отзыв предложения автором или governance-админом.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  governanceErrorResponse,
  loadGovernanceContext,
  serialiseForWire,
} from "../../_context";

export async function GET(
  req: NextRequest,
  { params }: { params: { proposalId: string } },
) {
  try {
    const { service, access } = await loadGovernanceContext(req);
    // Ленивый auto-close: пусть UI никогда не видит «активное»
    // предложение с истёкшим сроком. Ошибки игнорируем — они
    // проявятся ниже в `getProposal`.
    try {
      await service.closeAndMaybeExecute(params.proposalId);
    } catch {
      /* noop */
    }
    const detail = await service.getProposal(params.proposalId, access);
    return NextResponse.json({
      proposal: serialiseForWire(detail.proposal),
      votes: serialiseForWire(detail.votes),
      tally: serialiseForWire(detail.tally),
    });
  } catch (err) {
    return governanceErrorResponse(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { proposalId: string } },
) {
  try {
    const { service, access } = await loadGovernanceContext(req);
    const proposal = await service.cancel(params.proposalId, access);
    return NextResponse.json({ proposal: serialiseForWire(proposal) });
  } catch (err) {
    return governanceErrorResponse(err);
  }
}
