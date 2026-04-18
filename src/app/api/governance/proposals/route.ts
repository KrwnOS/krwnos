/**
 * `/api/governance/proposals`
 * ------------------------------------------------------------
 * GET  — лента предложений (опциональный фильтр `?status=active,passed`).
 *        Требует `governance.view`.
 * POST — создаёт новое предложение. Требует `governance.propose`;
 *        дополнительные гейты (`mode`, whitelist, minProposerBalance)
 *        применяются сервисом. Тело:
 *        {
 *          title: string,
 *          description: string,
 *          targetConfigKey: GovernanceManageableKey,
 *          newValue: unknown
 *        }
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  governanceErrorResponse,
  loadGovernanceContext,
  serialiseForWire,
} from "../_context";
import type { ProposalStatus } from "@/modules/governance";

const STATUSES: ProposalStatus[] = [
  "active",
  "passed",
  "rejected",
  "executed",
  "vetoed",
  "cancelled",
  "expired",
];

const CreateSchema = z
  .object({
    title: z.string().min(3).max(200),
    description: z.string().min(1).max(8000),
    targetConfigKey: z.string().min(1).max(64),
    newValue: z.unknown(),
  })
  .strict();

export async function GET(req: NextRequest) {
  try {
    const { stateId, service, access } = await loadGovernanceContext(req);
    const statusParam = req.nextUrl.searchParams.get("status");
    const status = statusParam
      ? statusParam
          .split(",")
          .map((s) => s.trim())
          .filter((s): s is ProposalStatus =>
            (STATUSES as string[]).includes(s),
          )
      : undefined;
    const limitRaw = req.nextUrl.searchParams.get("limit");
    const limit = limitRaw ? Math.max(1, Math.min(500, Number(limitRaw) || 100)) : 100;
    const proposals = await service.listProposals(stateId, access, {
      status,
      limit,
    });
    return NextResponse.json({
      proposals: serialiseForWire(proposals),
    });
  } catch (err) {
    return governanceErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { stateId, service, access } = await loadGovernanceContext(req);
    const body = CreateSchema.parse(await req.json());
    const proposal = await service.createProposal(stateId, access, {
      title: body.title,
      description: body.description,
      targetConfigKey: body.targetConfigKey,
      newValue: body.newValue,
    });
    return NextResponse.json(
      { proposal: serialiseForWire(proposal) },
      { status: 201 },
    );
  } catch (err) {
    return governanceErrorResponse(err);
  }
}
