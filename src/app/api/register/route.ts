/**
 * POST /api/register
 * ------------------------------------------------------------
 * Open registration — "Путь гражданина" тип А.
 *
 * Любой может создать аккаунт, но он падает в «Прихожую»
 * (Waiting Room) того State, в который пришёл. Повышение до
 * реального узла — ручное решение узла власти через
 * invite-ссылку или панель приёма.
 *
 * Тип Б (регистрация по инвайту) обслуживается отдельным
 * маршрутом `POST /api/invite/:token/accept`.
 *
 * Behaviour:
 *   * Creates a `User` (or reuses by handle/email).
 *   * Creates a `Membership` on the State's lobby node with
 *     `status = pending` — the Permissions Engine treats it as
 *     non-granting, so the user has no module access yet.
 *   * Auto-provisions a personal `Wallet` with balance = 0.
 *   * Never succeeds for a State that has no lobby (e.g. not
 *     initialised, or ops deleted it manually).
 *
 * Body:
 *   { stateSlug: string,
 *     handle: string,
 *     displayName?: string,
 *     email?: string }
 */

import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimitedResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const HANDLE_RE = /^[a-z0-9_]{3,32}$/;

const body = z.object({
  stateSlug: z.string().min(2).max(48),
  handle: z.string().min(3).max(32).regex(HANDLE_RE),
  displayName: z.string().max(80).optional(),
  email: z.string().email().optional(),
});

export async function POST(req: NextRequest) {
  const limited = await rateLimitedResponse(req, "api_register");
  if (limited) return limited;

  try {
    const parsed = body.parse(await req.json());
    const handle = parsed.handle.trim().toLowerCase();

    const state = await prisma.state.findUnique({
      where: { slug: parsed.stateSlug },
      select: { id: true },
    });
    if (!state) {
      return NextResponse.json(
        { error: "state_not_found" },
        { status: 404 },
      );
    }

    const lobby = await prisma.verticalNode.findFirst({
      where: { stateId: state.id, isLobby: true },
      select: { id: true },
    });
    if (!lobby) {
      return NextResponse.json(
        { error: "lobby_not_configured", message: "This State has no Waiting Room." },
        { status: 409 },
      );
    }

    // Handle collisions: if the handle is taken by a DIFFERENT user,
    // reject. If it's the SAME user (retry), we fall through and
    // upsert the membership.
    const existingByHandle = await prisma.user.findUnique({
      where: { handle },
      select: { id: true },
    });

    const result = await prisma.$transaction(async (tx) => {
      const user =
        existingByHandle ??
        (await tx.user.create({
          data: {
            handle,
            email: parsed.email ?? null,
            displayName: parsed.displayName ?? parsed.handle,
          },
          select: { id: true },
        }));

      await tx.membership.upsert({
        where: { userId_nodeId: { userId: user.id, nodeId: lobby.id } },
        create: {
          userId: user.id,
          nodeId: lobby.id,
          status: "pending",
          title: "Newcomer",
        },
        update: {
          // Re-register shouldn't silently promote anyone.
          status: "pending",
        },
      });

      // Auto-provision a personal wallet (idempotent).
      const existingWallet = await tx.wallet.findFirst({
        where: { stateId: state.id, userId: user.id, type: "PERSONAL" },
        select: { id: true },
      });
      const wallet =
        existingWallet ??
        (await tx.wallet.create({
          data: {
            stateId: state.id,
            type: "PERSONAL",
            userId: user.id,
            address: generateLedgerAddress(),
          },
          select: { id: true },
        }));

      return { userId: user.id, walletId: wallet.id };
    });

    return NextResponse.json(
      {
        status: "pending",
        message:
          "Registration accepted. Awaiting admission from a node of the Vertical.",
        userId: result.userId,
        walletId: result.walletId,
        stateId: state.id,
        lobbyNodeId: lobby.id,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_failed", issues: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error: "registration_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }
}

function generateLedgerAddress(): string {
  return `krwn1usr${randomBytes(16).toString("hex")}`;
}
