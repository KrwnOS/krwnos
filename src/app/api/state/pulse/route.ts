/**
 * GET /api/state/pulse
 *
 * Citizen-facing dashboard context — единый BFF-endpoint,
 * который агрегирует всё, что нужно странице Pulse (`/dashboard`):
 *
 *   * Viewer — кто я (userId, handle, displayName, флаг Суверена).
 *   * Role   — полный путь по Вертикали (от корня до моего узла),
 *              primaryNodeId (первый активный membership) и массив
 *              всех моих узлов. UI рисует это как «хлебные крошки»
 *              роли.
 *   * Wallet — баланс и валюта (через `WalletCoreService.ensurePersonal`).
 *              Пусто, если модуль wallet не включён (тогда поле null).
 *   * Tree   — все узлы Вертикали с метаданными (members, online,
 *              isLobby) для отрисовки сайдбара с индикатором присутствия.
 *
 * В отличие от `/api/admin/vertical`, этот route НЕ требует
 * `system.admin` — доступ открыт любому гражданину с CLI-токеном,
 * привязанным к State. Модификаций нет, только чтение.
 *
 * Аутентификация: CLI bearer token (та же схема, что и у
 * `/api/activity`, `/api/chat/*`, `/api/wallet/*`).
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  authenticateCli,
  CliAuthError,
} from "../../cli/auth";
import {
  WalletCoreService,
  createPrismaWalletRepository,
  WalletAccessError,
} from "@/modules/wallet";
import { eventBus } from "@/core";
import * as presence from "@/server/presence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cliLookup = {
  findByHash: async (tokenHash: string) =>
    prisma.cliToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        stateId: true,
        scopes: true,
        expiresAt: true,
        revokedAt: true,
      },
    }),
  touch: async (id: string) =>
    void (await prisma.cliToken.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    })),
};

interface NodeDto {
  id: string;
  parentId: string | null;
  title: string;
  type: "position" | "department" | "rank";
  order: number;
  isLobby: boolean;
  memberCount: number;
  onlineCount: number;
}

interface MemberDto {
  userId: string;
  nodeId: string;
  handle: string;
  displayName: string | null;
  online: boolean;
  isSelf: boolean;
}

interface WalletDtoLite {
  address: string;
  balance: number;
  currency: string;
}

interface PulseContextDto {
  viewer: {
    userId: string;
    handle: string;
    displayName: string | null;
    isOwner: boolean;
    isLobbyOnly: boolean;
  };
  state: {
    id: string;
    slug: string;
    name: string;
  };
  role: {
    primaryNodeId: string | null;
    nodeIds: string[];
    /** От корня к primaryNodeId, включительно. Пусто, если нет active membership. */
    path: Array<{ id: string; title: string; type: NodeDto["type"] }>;
  };
  wallet: WalletDtoLite | null;
  tree: {
    nodes: NodeDto[];
    members: MemberDto[];
    onlineUserIds: string[];
  };
  presenceWindowMs: number;
}

export async function GET(req: NextRequest) {
  try {
    const cli = await authenticateCli(req, cliLookup);
    if (!cli.stateId) {
      return NextResponse.json(
        { error: "Token is not scoped to any State.", code: "invalid_input" },
        { status: 400 },
      );
    }
    const stateId = cli.stateId;

    // Всё одним параллельным залпом — Pulse дёргается часто, хочется
    // один round-trip на Postgres, не десять.
    const [state, me, nodes, memberships] = await Promise.all([
      prisma.state.findUnique({
        where: { id: stateId },
        select: { id: true, slug: true, name: true, ownerId: true },
      }),
      prisma.user.findUnique({
        where: { id: cli.userId },
        select: { id: true, handle: true, displayName: true },
      }),
      prisma.verticalNode.findMany({
        where: { stateId },
        orderBy: [{ parentId: "asc" }, { order: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          parentId: true,
          title: true,
          type: true,
          order: true,
          isLobby: true,
        },
      }),
      prisma.membership.findMany({
        where: { node: { stateId }, status: "active" },
        select: {
          userId: true,
          nodeId: true,
          user: {
            select: { id: true, handle: true, displayName: true },
          },
        },
      }),
    ]);

    if (!state) {
      return NextResponse.json(
        { error: "State not found.", code: "not_found" },
        { status: 404 },
      );
    }
    if (!me) {
      return NextResponse.json(
        { error: "User not found.", code: "not_found" },
        { status: 404 },
      );
    }

    const isOwner = state.ownerId === me.id;

    // --- Presence snapshot for everyone we're about to return ---
    // `touch` самого себя — pulse-endpoint пулится клиентом каждые
    // ~15с, это ещё один keep-alive на случай, если SSE-коннект упал.
    presence.touch(me.id);
    const allUserIds = new Set<string>(memberships.map((m) => m.userId));
    const pres = presence.snapshot(allUserIds);

    // --- Build tree DTO: member + online counts per node ---
    const memberByNode = new Map<string, typeof memberships>();
    for (const m of memberships) {
      const bucket = memberByNode.get(m.nodeId) ?? [];
      bucket.push(m);
      memberByNode.set(m.nodeId, bucket);
    }

    const treeNodes: NodeDto[] = nodes.map((n) => {
      const bucket = memberByNode.get(n.id) ?? [];
      let onlineCount = 0;
      for (const m of bucket) if (pres.online.has(m.userId)) onlineCount++;
      return {
        id: n.id,
        parentId: n.parentId,
        title: n.title,
        type: n.type,
        order: n.order,
        isLobby: n.isLobby,
        memberCount: bucket.length,
        onlineCount,
      };
    });

    const members: MemberDto[] = memberships.map((m) => ({
      userId: m.userId,
      nodeId: m.nodeId,
      handle: m.user.handle,
      displayName: m.user.displayName,
      online: pres.online.has(m.userId),
      isSelf: m.userId === me.id,
    }));

    // --- Role path: walk ancestors for the first active membership ---
    // "Первый" определяется сортировкой `memberships` по убыванию
    // глубины узла (глубже = важнее роль). Если узлов несколько — UI
    // при необходимости покажет весь список в `role.nodeIds`.
    const parentOf = new Map<string, string | null>();
    for (const n of nodes) parentOf.set(n.id, n.parentId);

    const depthOf = (nodeId: string): number => {
      let d = 0;
      let cur: string | null = nodeId;
      const seen = new Set<string>();
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        const parent: string | null = parentOf.get(cur) ?? null;
        if (!parent) break;
        d++;
        cur = parent;
      }
      return d;
    };

    const myMemberships = memberships
      .filter((m) => m.userId === me.id)
      .sort((a, b) => depthOf(b.nodeId) - depthOf(a.nodeId));
    const primaryNodeId = myMemberships[0]?.nodeId ?? null;

    const titleOf = new Map(nodes.map((n) => [n.id, n]));
    const path: PulseContextDto["role"]["path"] = [];
    if (primaryNodeId) {
      const chain: string[] = [];
      let cur: string | null = primaryNodeId;
      const seen = new Set<string>();
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        chain.push(cur);
        const parent: string | null = parentOf.get(cur) ?? null;
        cur = parent;
      }
      for (const id of chain.reverse()) {
        const node = titleOf.get(id);
        if (node) {
          path.push({ id, title: node.title, type: node.type });
        }
      }
    }

    const isLobbyOnly =
      myMemberships.length > 0 &&
      myMemberships.every((m) => titleOf.get(m.nodeId)?.isLobby);

    // --- Wallet (optional: falls back gracefully if module не нужен) ---
    let wallet: WalletDtoLite | null = null;
    try {
      const walletService = new WalletCoreService({
        repo: createPrismaWalletRepository(prisma),
        bus: eventBus,
      });
      const w = await walletService.ensurePersonalWallet(stateId, me.id);
      wallet = {
        address: w.address,
        balance: w.balance,
        currency: w.currency,
      };
    } catch (err) {
      // Если wallet-модуль не поднят (нет primary StateAsset и т.п.) —
      // отдаём `null`, а не 500: Pulse должен работать даже без денег.
      if (err instanceof WalletAccessError) {
        wallet = null;
      } else if (err instanceof Error && /primary asset/i.test(err.message)) {
        wallet = null;
      } else {
        // Неизвестная ошибка — пробрасываем наружу, это баг.
        throw err;
      }
    }

    const dto: PulseContextDto = {
      viewer: {
        userId: me.id,
        handle: me.handle,
        displayName: me.displayName,
        isOwner,
        isLobbyOnly,
      },
      state: {
        id: state.id,
        slug: state.slug,
        name: state.name,
      },
      role: {
        primaryNodeId,
        nodeIds: myMemberships.map((m) => m.nodeId),
        path,
      },
      wallet,
      tree: {
        nodes: treeNodes,
        members,
        onlineUserIds: [...pres.online],
      },
      presenceWindowMs: presence.PRESENCE_WINDOW_MS,
    };

    return NextResponse.json(dto);
  } catch (err) {
    if (err instanceof CliAuthError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 500 },
    );
  }
}
