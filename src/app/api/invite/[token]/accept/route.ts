/**
 * POST /api/invite/:token/accept
 *
 * Web-facing invitation consumption endpoint. Requires a current
 * authenticated user (via the configured AuthAdapter). On success
 * redirects to the State desktop.
 *
 * Палата Указов — Citizenship Fee.
 * ------------------------------------------------------------
 * Если в `StateSettings.citizenshipFeeAmount > 0`, приём инвайта
 * автоматически списывает эту сумму с личного кошелька принимающего
 * пользователя в корневую Казну государства. Списание живёт в той
 * же Prisma-транзакции, что и создание `Membership` — либо и то, и
 * другое, либо ничего. Если на кошельке недостаточно средств,
 * бросается `InsufficientCitizenshipFeeError` и ни членство, ни
 * кошелёк не создаются.
 *
 * Пред-условие: у пользователя должен быть кошелёк с положительным
 * балансом *до* приёма инвайта (например, после пребывания в
 * Waiting Room и выплаты от спонсора). Свежий кошелёк с нулевым
 * балансом, созданный в этой же транзакции, не сможет оплатить
 * гражданство — это намеренное ограничение анти-спам-фильтра.
 */

import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimitedResponse } from "@/lib/rate-limit";
import { rejectIfCrossSiteMutation } from "@/lib/same-origin-mutation";
import {
  InvitationsService,
  type InvitationsRepository,
} from "@/core/invitations";
import { getAuth, UnauthorizedError } from "@/core";
import { ledgerDecimal, moneyToNumber } from "@/modules/wallet/money";

class InsufficientCitizenshipFeeError extends Error {
  constructor(
    public readonly required: number,
    public readonly available: number,
  ) {
    super(
      `Insufficient balance to pay the citizenship fee: required ${required}, ` +
        `available ${available}. Acquire funds via the Waiting Room or an ` +
        `inviter's grant, then re-accept the invitation.`,
    );
    this.name = "InsufficientCitizenshipFeeError";
  }
}

const repo: InvitationsRepository = {
  insert: async () => {
    throw new Error("insert not used from accept route");
  },
  findByTokenHash: async (hash) => {
    const row = await prisma.invitation.findUnique({ where: { tokenHash: hash } });
    return row as any;
  },
  findByCode: async (code) => {
    const row = await prisma.invitation.findUnique({ where: { code } });
    return row as any;
  },
  updateStatus: async (id, status, consumedAt) => {
    await prisma.invitation.update({
      where: { id },
      data: { status, consumedAt: consumedAt ?? null },
    });
  },
  incrementUses: async (id) => {
    const row = await prisma.invitation.update({
      where: { id },
      data: { usesCount: { increment: 1 } },
    });
    return row as any;
  },
  /**
   * On acceptance:
   *   1. Create (or activate) membership in the target node.
   *   2. Demote any `pending` membership on THIS State's lobby —
   *      the user just graduated from Waiting Room to Citizen.
   *   3. Auto-provision a personal wallet for this State.
   *   4. If `StateSettings.citizenshipFeeAmount > 0`, debit the
   *      citizen's primary-asset wallet and credit the root
   *      Treasury. The whole block is atomic.
   */
  createMembership: async (userId, nodeId) => {
    // Look up the State via the target node so we can scope the
    // wallet and the lobby sweep to it.
    const node = await prisma.verticalNode.findUnique({
      where: { id: nodeId },
      select: { stateId: true },
    });
    if (!node) {
      throw new Error(`Invitation target node ${nodeId} not found`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.membership.upsert({
        where: { userId_nodeId: { userId, nodeId } },
        create: { userId, nodeId, status: "active" },
        update: { status: "active" },
      });

      // Sweep any lingering Waiting Room membership in this State.
      const lobby = await tx.verticalNode.findFirst({
        where: { stateId: node.stateId, isLobby: true },
        select: { id: true },
      });
      if (lobby) {
        await tx.membership
          .delete({
            where: { userId_nodeId: { userId, nodeId: lobby.id } },
          })
          .catch(() => {}); // safe: no-op if absent
      }

      // Resolve the State's primary asset once — we need it for
      // wallet provisioning and for citizenship-fee accounting.
      const primaryAsset = await (
        tx as unknown as {
          stateAsset: {
            findFirst: (args: unknown) => Promise<
              | {
                  id: string;
                  symbol: string;
                  decimals: number;
                }
              | null
            >;
          };
        }
      ).stateAsset.findFirst({
        where: { stateId: node.stateId, isPrimary: true },
        select: { id: true, symbol: true, decimals: true },
      });

      // Idempotent wallet provisioning — one wallet per
      // (user, state, primary-asset). If no primary asset has been
      // declared yet we still create a legacy wallet so the user
      // can onboard; fees can only be charged when an asset exists.
      const existing = await tx.wallet.findFirst({
        where: {
          stateId: node.stateId,
          userId,
          type: "PERSONAL",
          ...(primaryAsset ? { assetId: primaryAsset.id } : {}),
        },
        select: { id: true, balance: true },
      });
      const walletRow =
        existing ??
        (await tx.wallet.create({
          data: {
            stateId: node.stateId,
            type: "PERSONAL",
            userId,
            address: `krwn1usr${randomBytes(16).toString("hex")}`,
            currency: primaryAsset?.symbol ?? "KRN",
            assetId: primaryAsset?.id ?? null,
            balance: 0,
          },
          select: { id: true, balance: true },
        }));

      // Палата Указов — Citizenship Fee.
      const settings = await (
        tx as unknown as {
          stateSettings: {
            findUnique: (args: unknown) => Promise<
              | {
                  citizenshipFeeAmount: number;
                }
              | null
            >;
          };
        }
      ).stateSettings.findUnique({
        where: { stateId: node.stateId },
        select: { citizenshipFeeAmount: true },
      });

      const fee = settings?.citizenshipFeeAmount ?? 0;
      if (fee > 0 && primaryAsset) {
        // Freshly-hydrated balance — `walletRow.balance` came from
        // the same transaction, so it reflects any concurrent
        // writes that already committed before tx started.
        const bal = ledgerDecimal(walletRow.balance);
        if (bal.lt(fee)) {
          throw new InsufficientCitizenshipFeeError(
            fee,
            moneyToNumber(bal),
          );
        }

        // Root treasury wallet for the state's primary asset.
        // Rooted at the Sovereign's node (parentId = null). We
        // auto-provision it if missing — required when an admin
        // enabled citizenship fees before ever running a first
        // state transfer.
        const rootNode = await tx.verticalNode.findFirst({
          where: { stateId: node.stateId, parentId: null },
          select: { id: true },
        });
        if (!rootNode) {
          throw new Error(
            `State ${node.stateId} has no root node; cannot route citizenship fee.`,
          );
        }
        let treasury = await tx.wallet.findFirst({
          where: {
            stateId: node.stateId,
            nodeId: rootNode.id,
            type: "TREASURY",
            assetId: primaryAsset.id,
          },
          select: { id: true },
        });
        if (!treasury) {
          treasury = await tx.wallet.create({
            data: {
              stateId: node.stateId,
              type: "TREASURY",
              nodeId: rootNode.id,
              address: `krwn1tre${randomBytes(16).toString("hex")}`,
              currency: primaryAsset.symbol,
              assetId: primaryAsset.id,
              balance: 0,
            },
            select: { id: true },
          });
        }

        // Atomic debit-credit. We rely on a non-null balance check
        // inside Prisma's update to prevent double-spend under
        // optimistic concurrency — two concurrent invite accepts
        // against the same wallet would both read the same
        // starting balance, but only one `updateMany` can succeed
        // because the where-clause demands `balance >= fee`.
        const debit = await tx.wallet.updateMany({
          where: { id: walletRow.id, balance: { gte: fee } },
          data: { balance: { decrement: fee } },
        });
        if (debit.count !== 1) {
          throw new InsufficientCitizenshipFeeError(
            fee,
            moneyToNumber(ledgerDecimal(walletRow.balance)),
          );
        }
        await tx.wallet.update({
          where: { id: treasury.id },
          data: { balance: { increment: fee } },
        });

        await tx.transaction.create({
          data: {
            stateId: node.stateId,
            fromWalletId: walletRow.id,
            toWalletId: treasury.id,
            kind: "treasury_allocation",
            status: "completed",
            amount: fee,
            assetId: primaryAsset.id,
            currency: primaryAsset.symbol,
            initiatedById: userId,
            metadata: {
              reason: "citizenship_fee",
              nodeId,
            },
          },
        });
      }
    });
  },
};

const service = new InvitationsService(repo);

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } },
) {
  const limited = await rateLimitedResponse(req, "api_invite_accept");
  if (limited) return limited;

  const csrf = rejectIfCrossSiteMutation(req);
  if (csrf) return csrf;

  try {
    const user = await getAuth().requireUser();

    const result = await service.consume({ token: params.token, user });

    const state = await prisma.state.findUnique({
      where: { id: result.invitation.stateId },
      select: { slug: true },
    });

    const url = new URL(`/s/${state?.slug ?? ""}`, req.nextUrl.origin);
    return NextResponse.redirect(url, { status: 303 });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      const loginUrl = new URL("/login", req.nextUrl.origin);
      loginUrl.searchParams.set("invite", params.token);
      return NextResponse.redirect(loginUrl, { status: 303 });
    }
    if (err instanceof InsufficientCitizenshipFeeError) {
      return NextResponse.json(
        {
          error: err.message,
          code: "insufficient_citizenship_fee",
          required: err.required,
          available: err.available,
        },
        { status: 402 }, // Payment Required
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 400 },
    );
  }
}
