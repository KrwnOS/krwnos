/**
 * `GET /api/admin/nexus` — aggregated data for the Sovereign's Nexus.
 * ------------------------------------------------------------
 * Nexus is the main control room. The endpoint folds into a single
 * round-trip everything the three default cards need:
 *
 *   * Вертикаль — общее число узлов власти (`VerticalNode.count`).
 *   * Экономика — первичный `StateAsset` + его `taxRate` + суммарный
 *                 объём (aggregated positive `Wallet.balance`) и
 *                 `transactionTaxRate` из Палаты Указов.
 *   * Законы    — 3 последних Proposals из модуля Governance.
 *                 Модуля ещё нет — возвращаем `installed: false` и
 *                 пустой массив. Когда плагин приедет, он зарегистрируется
 *                 через InstalledModule и заполнит `proposals`.
 *
 * Авторизация: только Суверен государства (`isOwner`) или держатель
 * глобального `system.admin` (включая `*`, `system.*`). Всем
 * остальным — 403, а UI делает redirect на общую ленту.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { PermissionKey } from "@/types/kernel";
import { loadStateContext, stateErrorResponse } from "../../state/_context";

const NEXUS_PERMISSION: PermissionKey = "system.admin";
const GOVERNANCE_SLUGS = ["governance", "core.governance"] as const;

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

    const [totalNodes, primaryAsset, settings, governanceModule] =
      await Promise.all([
        prisma.verticalNode.count({ where: { stateId } }),
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
      ]);

    const totalSupply = primaryAsset
      ? await computeTotalSupply(stateId, primaryAsset.id)
      : 0;

    const recentProposals = governanceModule
      ? await loadRecentProposals(stateId)
      : [];

    return NextResponse.json({
      state: { id: stateId },
      vertical: {
        totalNodes,
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
