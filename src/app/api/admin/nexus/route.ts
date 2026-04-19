/**
 * `GET /api/admin/nexus` — aggregated data for the Sovereign's Nexus.
 * ------------------------------------------------------------
 * Nexus is the main control room. The endpoint folds into a single
 * round-trip everything the dashboard needs to render:
 *
 *   * State header  — name / slug / created / owner display name +
 *                     online/synchronised heartbeat flags.
 *   * Вертикаль     — общее число узлов власти + число активных
 *                     граждан (distinct user ids on `active` memberships).
 *   * Экономика     — первичный `StateAsset` + его `taxRate` + суммарный
 *                     объём (aggregated positive `Wallet.balance`) и
 *                     `transactionTaxRate` из Палаты Указов. Сюда же
 *                     прилетает id корневой Treasury — на него по
 *                     умолчанию ложится результат `POST /api/wallet/mint`.
 *   * Активность    — 5 последних строк «Пульса Государства» (фильтр
 *                     видимости отключён: Суверен видит всё).
 *   * Законы        — 3 последних Proposals из модуля Governance
 *                     (если модуль установлен).
 *
 * Авторизация: только Суверен государства (`isOwner`) или держатель
 * глобального `system.admin` (включая `*`, `system.*`). Всем
 * остальным — 403, а UI делает redirect на общую ленту.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { PermissionKey } from "@/types/kernel";
import { getActivityFeed } from "@/server/activity-boot";
import { loadStateContext, stateErrorResponse } from "../../state/_context";

const NEXUS_PERMISSION: PermissionKey = "system.admin";
const GOVERNANCE_SLUGS = ["governance", "core.governance"] as const;
const ACTIVITY_RECENT_LIMIT = 5;

type ProposalStatus =
  | "draft"
  | "open"
  | "passed"
  | "rejected"
  | "executed"
  | "expired";

interface ProposalDto {
  id: string;
  title: string;
  status: ProposalStatus;
  createdAt: string;
}

interface ActivityDto {
  id: string;
  event: string;
  category: string;
  titleKey: string;
  titleParams: Record<string, unknown>;
  actorId: string | null;
  nodeId: string | null;
  createdAt: string;
}

export async function GET(req: NextRequest) {
  try {
    const { stateId, access, service } = await loadStateContext(req);

    if (!isSovereignOrAdmin(access.isOwner, access.permissions)) {
      return NextResponse.json(
        {
          error:
            "Nexus доступен только Суверену или держателю system.admin.",
          code: "forbidden",
        },
        { status: 403 },
      );
    }

    const [state, totalNodes, activeCitizens, primaryAsset, settings, governanceModule, rootNode] =
      await Promise.all([
        prisma.state.findUnique({
          where: { id: stateId },
          select: {
            id: true,
            slug: true,
            name: true,
            createdAt: true,
            updatedAt: true,
            owner: { select: { id: true, handle: true, displayName: true } },
          },
        }),
        prisma.verticalNode.count({ where: { stateId } }),
        countActiveCitizens(stateId),
        prisma.stateAsset.findFirst({
          where: { stateId, isPrimary: true },
          select: {
            id: true,
            symbol: true,
            name: true,
            decimals: true,
            taxRate: true,
            canMint: true,
            publicSupply: true,
            icon: true,
            color: true,
          },
        }),
        service.get(stateId),
        prisma.installedModule.findFirst({
          where: {
            stateId,
            slug: { in: [...GOVERNANCE_SLUGS] },
            enabled: true,
          },
          select: { slug: true },
        }),
        prisma.verticalNode.findFirst({
          where: { stateId, parentId: null },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            treasuryWallet: { select: { id: true, address: true } },
          },
        }),
      ]);

    if (!state) {
      return NextResponse.json(
        { error: "State not found.", code: "not_found" },
        { status: 404 },
      );
    }

    const totalSupply = primaryAsset
      ? await computeTotalSupply(stateId, primaryAsset.id)
      : 0;

    const recentProposals = governanceModule
      ? await loadRecentProposals(stateId)
      : [];

    const recentActivity = await loadRecentActivity(stateId, {
      userId: access.userId,
      isOwner: access.isOwner,
    });

    return NextResponse.json({
      state: {
        id: state.id,
        slug: state.slug,
        name: state.name,
        createdAt: state.createdAt.toISOString(),
        updatedAt: state.updatedAt.toISOString(),
        owner: state.owner
          ? {
              id: state.owner.id,
              handle: state.owner.handle,
              displayName: state.owner.displayName,
            }
          : null,
      },
      vertical: {
        totalNodes,
        totalCitizens: activeCitizens,
        rootNodeId: rootNode?.id ?? null,
      },
      economy: {
        primaryAsset: primaryAsset
          ? {
              id: primaryAsset.id,
              symbol: primaryAsset.symbol,
              name: primaryAsset.name,
              taxRate: primaryAsset.taxRate,
              totalSupply,
              canMint: primaryAsset.canMint,
              publicSupply: primaryAsset.publicSupply,
              icon: primaryAsset.icon,
              color: primaryAsset.color,
            }
          : null,
        transactionTaxRate: settings.transactionTaxRate,
        currencyDisplayName: settings.currencyDisplayName,
        rootTreasuryWalletId: rootNode?.treasuryWallet?.id ?? null,
      },
      activity: {
        entries: recentActivity,
      },
      governance: {
        installed: Boolean(governanceModule),
        moduleSlug: governanceModule?.slug ?? null,
        proposals: recentProposals,
      },
    });
  } catch (err) {
    return stateErrorResponse(err);
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/**
 * Nexus gate. Sovereign всегда проходит; все остальные — только если
 * у них есть глобальный `system.admin`, домен-вайлдкард `system.*`
 * или супер-право `*`.
 */
function isSovereignOrAdmin(
  isOwner: boolean,
  held: ReadonlySet<PermissionKey>,
): boolean {
  if (isOwner) return true;
  if (held.has("*")) return true;
  if (held.has(NEXUS_PERMISSION)) return true;
  if (held.has("system.*" as PermissionKey)) return true;
  return false;
}

/**
 * Число активных граждан = число уникальных `userId` с хотя бы одной
 * `active`-мембершипой. Sovereign (owner of the State) всегда
 * учитывается — даже если его имени формально нет на Вертикали.
 */
async function countActiveCitizens(stateId: string): Promise<number> {
  const rows = await prisma.membership.findMany({
    where: { node: { stateId }, status: "active" },
    distinct: ["userId"],
    select: { userId: true },
  });
  const unique = new Set(rows.map((r) => r.userId));
  // Dip in the owner: memberships are optional for the State owner
  // in early setup stages — but they're still a citizen.
  const state = await prisma.state.findUnique({
    where: { id: stateId },
    select: { ownerId: true },
  });
  if (state?.ownerId) unique.add(state.ownerId);
  return unique.size;
}

/**
 * Сумма положительных балансов по активу — самый дешёвый прокси
 * «объёма валюты в системе». Для ON_CHAIN активов это кешированный
 * снапшот, обновляемый Treasury Watcher-ом. Мы намеренно не
 * вычитаем «burn» / «treasury», чтобы показать совокупный
 * циркулирующий объём в UI без хирургии.
 */
async function computeTotalSupply(
  stateId: string,
  assetId: string,
): Promise<number> {
  const aggregate = await prisma.wallet.aggregate({
    where: { stateId, assetId, balance: { gt: 0 } },
    _sum: { balance: true },
  });
  return aggregate._sum.balance ?? 0;
}

/**
 * Говернанс-модуль пока не написан. Когда плагин приедет, он обязан
 * завести таблицу с колонками `stateId`, `title`, `status`,
 * `createdAt` — тогда здесь появится реальный `prisma.proposal.*`
 * вызов. Сейчас безопасный stub, который:
 *   * НЕ падает, если таблицы ещё нет;
 *   * возвращает пустой список.
 * Любая будущая имплементация сможет вернуть до трёх последних
 * `ProposalDto`, сохранив контракт.
 */
async function loadRecentProposals(_stateId: string): Promise<ProposalDto[]> {
  try {
    const client = prisma as unknown as {
      proposal?: {
        findMany: (args: unknown) => Promise<
          Array<{
            id: string;
            title: string;
            status: string;
            createdAt: Date;
          }>
        >;
      };
    };
    if (!client.proposal) return [];
    const rows = await client.proposal.findMany({
      where: { stateId: _stateId },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { id: true, title: true, status: true, createdAt: true },
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status as ProposalStatus,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch {
    return [];
  }
}

/**
 * Последние N событий ленты с точки зрения Суверена (owner видит всё).
 * Мы зовём `ActivityFeedService.listForViewer` с `scopeNodeIds = ∅`,
 * потому что для owner-а фильтр всё равно обходится.
 *
 * Любая неполадка (например, таблица ActivityLog ещё не создана в
 * окружении, где миграции не применены) приводит к `[]` — Nexus не
 * должен падать из-за некритичной карточки.
 */
async function loadRecentActivity(
  stateId: string,
  caller: { userId: string; isOwner: boolean },
): Promise<ActivityDto[]> {
  try {
    const service = getActivityFeed();
    const rows = await service.listForViewer(
      {
        userId: caller.userId,
        stateId,
        isOwner: caller.isOwner,
        scopeNodeIds: new Set<string>(),
      },
      { limit: ACTIVITY_RECENT_LIMIT },
    );
    return rows.map((row) => ({
      id: row.id,
      event: row.event,
      category: row.category,
      titleKey: row.titleKey,
      titleParams: row.titleParams,
      actorId: row.actorId,
      nodeId: row.nodeId,
      createdAt: row.createdAt.toISOString(),
    }));
  } catch {
    return [];
  }
}
