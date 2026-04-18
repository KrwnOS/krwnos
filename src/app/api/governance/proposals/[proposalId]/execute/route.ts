/**
 * `POST /api/governance/proposals/[proposalId]/execute`
 *
 * Ручное исполнение успешного предложения в режиме `consultation`.
 * В `auto_dao` Executor уже применил решение — endpoint будет
 * возвращать 410 (closed). Требует `governance.admin` (или Суверена).
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  governanceErrorResponse,
  loadGovernanceContext,
  serialiseForWire,
} from "../../../_context";

export async function POST(
  req: NextRequest,
  { params }: { params: { proposalId: string } },
) {
  try {
    const { service, access } = await loadGovernanceContext(req);
    const proposal = await service.execute(params.proposalId, access);
    return NextResponse.json({ proposal: serialiseForWire(proposal) });
  } catch (err) {
    return governanceErrorResponse(err);
  }
}
